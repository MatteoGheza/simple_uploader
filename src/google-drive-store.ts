import { DataStore, Upload } from '@tus/server';
import { google, drive_v3 } from 'googleapis';
import { Readable } from 'node:stream';
import fetch from 'node-fetch';
import logger from './logger';
import {
  GDRIVE_RESUMABLE_INCOMPLETE,
  SESSION_TTL_MS,
  CLEANUP_INTERVAL_MS,
  MAX_CHUNK_BUFFER_SIZE
} from './config/config';

interface GDriveUploadSession {
  upload: unknown;
  sessionUri: string;
  lastActivity: number;
}

interface FolderPromise {
  promise: Promise<string>;
  lastActivity: number;
}

export class GoogleDriveStore extends DataStore {
  private sessions = new Map<string, GDriveUploadSession>();
  private drive: drive_v3.Drive;
  private folderId: string;
  private folderPromises = new Map<string, FolderPromise>();

  /*
   * Using any here because of version mismatches in transitive google-auth-library dependencies
   * which is a known issue when multiple packages depend on different versions of the Google SDK.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(auth: any, folderId: string) {
    super();
    this.drive = google.drive({ version: 'v3', auth });
    this.folderId = folderId;

    // Periodic cleanup of stale sessions and promises
    setInterval(() => this.cleanupStaleSessions(), CLEANUP_INTERVAL_MS);
  }

  private cleanupStaleSessions(): void {
    const now = Date.now();

    // Cleanup sessions
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }

    // Cleanup folder promises
    for (const [name, folder] of this.folderPromises.entries()) {
      if (now - folder.lastActivity > SESSION_TTL_MS) {
        this.folderPromises.delete(name);
      }
    }
  }

  private async getOrCreateUserFolder(
    userName: string,
    sessionId: string
  ): Promise<string> {
    const sanitizedUser = userName.replace(/[^a-zA-Z0-9\s-]/g, '').trim();
    if (!sanitizedUser) throw new Error('Invalid user name for folder creation');

    const sanitizedSession = sessionId.replace(/[^a-zA-Z0-9]/g, '');
    if (!sanitizedSession) throw new Error('Invalid session ID');

    const date = new Date().toISOString().split('T')[0].replace(/-/g, '-');
    /*
     * Using sessionId to ensure all files in one "session"
     * go to the same folder
     */
    const userSuffix = sanitizedUser.replace(/\s+/g, '_');
    const folderName = `${userSuffix}_${date}_${sanitizedSession}`;

    const existing = this.folderPromises.get(folderName);
    if (existing) {
      existing.lastActivity = Date.now();
      return existing.promise;
    }

    const creationPromise = (async () => {
      const query = `name = '${folderName}' and ` +
        `'${this.folderId}' in parents and ` +
        `mimeType = 'application/vnd.` +
        `google-apps.folder' and trashed = false`;

      const response = await this.drive.files.list({
        q: query,
        fields: 'files(id)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });

      if (response.data.files && response.data.files.length > 0) {
        return response.data.files[0].id!;
      }

      const createResponse = await this.drive.files.create({
        requestBody: {
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [this.folderId]
        },
        fields: 'id',
        supportsAllDrives: true
      });

      return createResponse.data.id!;
    })();

    this.folderPromises.set(folderName, {
      promise: creationPromise,
      lastActivity: Date.now()
    });
    creationPromise.catch(() => this.folderPromises.delete(folderName));
    return creationPromise;
  }

  async create(upload: Upload): Promise<Upload> {
    const fileName = upload.metadata?.filename || `upload-${Date.now()}`;
    const mimeType = upload.metadata?.filetype || 'application/octet-stream';
    const fileSize = upload.size || 0;
    const userName = upload.metadata?.userName || 'Anonymous';
    const sessionId = upload.metadata?.sessionId || Date.now().toString();

    const targetFolderId = await this.getOrCreateUserFolder(userName, sessionId);

    logger.info(`[GDriveStore] [${upload.id}] Initiating: ${fileName}`);
    logger.debug(`[GDriveStore] [${upload.id}] Size: ${fileSize} to folder: ${targetFolderId}`);

    /*
     * Initiate Resumable Upload on GDrive
     * Ref: https://developers.google.com/drive/api/v3/manage-uploads#resumable
     * For Shared Drives (Team Drives), supportsAllDrives=true is MANDATORY.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auth = this.drive.context._options.auth as any;
    const authClient = await auth.getAccessToken();
    const response = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files?` +
      `uploadType=resumable&supportsAllDrives=true`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authClient.token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': fileSize.toString()
        },
        body: JSON.stringify({ name: fileName, parents: [targetFolderId] })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`[GDriveStore] [${upload.id}] Init failed: ${response.status} ${errorText}`);
      throw new Error(`Failed to initiate: ${response.statusText}`);
    }

    const sessionUri = response.headers.get('location');
    if (!sessionUri) throw new Error('GDrive did not return session URI');

    const newUpload = upload;
    newUpload.offset = 0;
    this.sessions.set(upload.id, {
      upload: newUpload,
      sessionUri,
      lastActivity: Date.now()
    });

    return newUpload;
  }

  async write(readable: Readable, id: string, offset: number): Promise<number> {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Upload session not found');
    session.lastActivity = Date.now();

    let bytesRead = 0;
    const chunks: Buffer[] = [];

    for await (const chunk of readable) {
      bytesRead += chunk.length;
      if (bytesRead > MAX_CHUNK_BUFFER_SIZE) {
        this.sessions.delete(id);
        throw new Error('Chunk size limit exceeded');
      }
      chunks.push(chunk);
    }

    if (bytesRead === 0) return 0;

    const buffer = Buffer.concat(chunks);
    const end = offset + bytesRead - 1;
    const uploadSession = session.upload as Upload;

    /*
     * Capture the data to determine the length of this chunk
     * GDrive Resumable Upload requires knowing the Content-Length of the chunk
     * or we can stream if we use the correct headers, but GDrive PUT expects a specific range.
     */

    logger.debug(`[GDriveStore] [${id}] Writing ${bytesRead} bytes at offset ${uploadSession.offset} (Total size: ${uploadSession.size})`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auth = this.drive.context._options.auth as any;
    const authClient = await auth.getAccessToken();
    const sessionUri = `${session.sessionUri}` +
      `${session.sessionUri.includes('?') ? '&' : '?'}supportsAllDrives=true`;

    const response = await fetch(sessionUri, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${authClient.token}`,
        'Content-Range': `bytes ${uploadSession.offset}-${end}/${uploadSession.size}`,
        'Content-Length': bytesRead.toString()
      },
      body: buffer
    });

    if (response.status !== GDRIVE_RESUMABLE_INCOMPLETE && !response.ok) {
      const errorText = await response.text();
      logger.error(`[GDriveStore] [${id}] Write failed: ${response.status} ${errorText}`);
      this.sessions.delete(id);
      throw new Error(`Write failed: ${response.statusText} - ${errorText}`);
    }

    uploadSession.offset += bytesRead;
    logger.debug(`[GDriveStore] [${id}] Chunk success. New offset: ${uploadSession.offset}`);

    // Return the new offset as required by Tus DataStore
    return uploadSession.offset;
  }

  async getUpload(id: string): Promise<Upload> {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Upload not found');
    session.lastActivity = Date.now();
    return session.upload as Upload;
  }

  async remove(id: string): Promise<void> {
    this.sessions.delete(id);
  }
}
