import 'dotenv/config';
import express from 'express';
import { Command } from 'commander';
import logger, { setLogLevel } from './logger';
import { Liquid } from 'liquidjs';
import { Server, Upload } from '@tus/server';
import { GoogleDriveStore } from './google-drive-store';
import { google } from 'googleapis';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';
import {
  config,
  NAME_MIN_LENGTH,
  NAME_MAX_LENGTH,
  COOKIE_MAX_AGE_DAYS,
  MS_PER_DAY,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX,
  UPPY_MAX_FILE_SIZE
} from './config/config';

const app = express();
const port = config.port;
const MINUTES_IN_HOUR = 60;

const program = new Command();
program
  .option('-l, --level <level>', 'log level', 'info')
  .parse(process.argv);

setLogLevel(program.opts().level);

const SECONDS_IN_MINUTE = 60;
const MS_IN_SECOND = 1000;
const TOKEN_EXPIRY_MS = MINUTES_IN_HOUR * SECONDS_IN_MINUTE * MS_IN_SECOND;

// Security: Trust Proxy for accurate rate limiting
app.set('trust proxy', config.trustProxy);

// Security: Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'script-src': [
        "'self'",
        "'unsafe-inline'",
        'https://releases.transloadit.com',
        'https://cdn.jsdelivr.net',
        'https://challenges.cloudflare.com'
      ],
      'style-src': [
        "'self'",
        "'unsafe-inline'",
        'https://releases.transloadit.com'
      ],
      'connect-src': [
        "'self'",
        'https://www.googleapis.com',
        'https://challenges.cloudflare.com',
        'https://releases.transloadit.com'
      ],
      'frame-src': ["'self'", 'https://challenges.cloudflare.com'],
      'img-src': ["'self'", 'data:', 'blob:']
    }
  }
}));

// Google Drive Auth
const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/drive.file']
});

const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '';

interface TurnstileOutcome {
  success: boolean;
  'error-codes': string[];
}

logger.info(`Turnstile is ${process.env.DISABLE_TURNSTILE === 'true' ? 'disabled' : 'enabled'}`);

// Tus Server
const tusServer = new Server({
  path: '/upload',
  datastore: new GoogleDriveStore(auth, folderId),
  maxSize: UPPY_MAX_FILE_SIZE,
  namingFunction: () => {
    return uuidv4();
  },
  onUploadCreate: async (req, upload: Upload) => {
    // Auth Token Verification via Metadata
    const isTurnstileDisabled = process.env.DISABLE_TURNSTILE === 'true';
    if (!isTurnstileDisabled) {
      const token = upload.metadata?.uploadToken;

      if (!token) {
        throw { status_code: 403, body: 'Token di autenticazione mancante in metadati' };
      }

      try {
        jwt.verify(token as string, config.jwtSecret);
      } catch {
        throw { status_code: 403, body: 'Token di autenticazione non valido' };
      }
    }

    const fileType = upload.metadata?.filetype || '';
    const isAllowedType = fileType.startsWith('image/') || fileType.startsWith('video/');

    if (!isAllowedType) {
      throw { status_code: 400, body: 'Tipo di file non consentito' };
    }

    return { metadata: upload.metadata };
  }
});

// Rate Limiting
const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Troppe richieste da questo IP, riprova tra 15 minuti'
});

// Middleware
app.use(limiter);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/static', express.static(path.resolve(__dirname, '../static')));
app.use('/favicon.ico', express.static(path.resolve(__dirname, '../static/favicon.ico')));

// LiquidJS Setup
const engine = new Liquid();
app.engine('liquid', engine.express());
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'liquid');

// Routes
app.get('/', (req, res) => {
  const userName = req.cookies.userName;
  res.render('index', {
    userName,
    siteKey: process.env.CF_TURNSTILE_SITE_KEY,
    isTurnstileEnabled: process.env.DISABLE_TURNSTILE !== 'true'
  });
});

app.post('/verify-turnstile', async (req, res) => {
  const token = req.body['cf-turnstile-response'];
  const ip = req.ip;

  const formData = new URLSearchParams();
  formData.append('secret', process.env.CF_TURNSTILE_SECRET_KEY || '');
  formData.append('response', token);
  formData.append('remoteip', ip || '');

  const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: formData
  });
  const outcome = (await result.json()) as TurnstileOutcome;

  if (!outcome.success) {
    return res.status(403).send('Verifica Turnstile fallita');
  }

  // Issue upload token
  const uploadToken = jwt.sign({ sub: 'user' }, config.jwtSecret, { expiresIn: TOKEN_EXPIRY_MS / 1000 });
  res.json({ uploadToken });
});

app.post('/set-user', (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length < NAME_MIN_LENGTH) {
    return res.status(400).send('Nome non valido');
  }

  // Sanitize and enforce max length
  const sanitizedName = name.trim()
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .substring(0, NAME_MAX_LENGTH);

  res.cookie('userName', sanitizedName, {
    maxAge: COOKIE_MAX_AGE_DAYS * MS_PER_DAY,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  });

  res.redirect('/');
});

/*
 * Tus Upload Route
 * The tus server handles PATCH, POST, HEAD, OPTIONS, DELETE
 */
app.use('/upload', (req, res) => {
  tusServer.handle(req, res);
});

app.listen(port, () => {
  logger.info(`Server is running on http://localhost:${port}`);
});
