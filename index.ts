import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = 3000;

app.set('trust proxy', 1);

// =====================================================
// BODY PARSERS + RAW BODY CAPTURE
// =====================================================

app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  }),
);

app.use(
  express.urlencoded({
    extended: true,
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  }),
);

app.use(
  express.text({
    type: ['text/plain', 'application/octet-stream'],
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  }),
);

app.use(cors());

// =====================================================
// RATE LIMIT
// =====================================================

const limiter = rateLimit({
  windowMs: 60_000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    trustProxy: false,
    xForwardedForHeader: false,
  },
});

app.use(limiter);

// =====================================================
// STATIC FILES
// =====================================================

app.use(express.static(path.join(process.cwd(), 'public')));

// =====================================================
// REQUEST LOGGER
// =====================================================

app.use((req: Request, _res: Response, next: NextFunction) => {
  const clientIp =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket.remoteAddress ||
    'unknown';

  console.log(
    `[REQ] ${req.method} ${req.path} -> ${clientIp}`,
  );

  next();
});

// =====================================================
// ROOT
// =====================================================

app.get('/', (_req: Request, res: Response) => {
  res.status(200).send('GTLogin running!');
});

// =====================================================
// LOGIN DASHBOARD
// =====================================================

app.all(
  '/player/login/dashboard',
  async (req: Request, res: Response) => {
    try {
      let clientData = '';

      const rawBody = (req as any).rawBody as
        | string
        | undefined;

      const contentType =
        req.headers['content-type'] || '';

      // Growtopia normally sends its client data here.
      if (rawBody && rawBody.length > 0) {
        if (
          contentType.includes(
            'application/x-www-form-urlencoded',
          )
        ) {
          try {
            const params = new URLSearchParams(rawBody);
            const entries = Array.from(params.entries());

            // Common Growtopia format:
            // one huge key with empty value.
            if (
              entries.length === 1 &&
              entries[0][1] === ''
            ) {
              clientData = entries[0][0];
            } else {
              try {
                clientData = decodeURIComponent(
                  rawBody.replace(/\+/g, ' '),
                );
              } catch {
                clientData = rawBody;
              }
            }
          } catch {
            try {
              clientData = decodeURIComponent(
                rawBody.replace(/\+/g, ' '),
              );
            } catch {
              clientData = rawBody;
            }
          }
        } else {
          try {
            clientData = decodeURIComponent(
              rawBody.replace(/\+/g, ' '),
            );
          } catch {
            clientData = rawBody;
          }
        }
      }

      // Fallback to parsed body.
      if (!clientData && req.body) {
        if (typeof req.body === 'string') {
          clientData = req.body;
        } else if (typeof req.body === 'object') {
          const body =
            req.body as Record<string, unknown>;

          const keys = Object.keys(body);

          if (keys.length > 0) {
            if (
              keys.length === 1 &&
              body[keys[0]] === ''
            ) {
              clientData = keys[0];
            } else {
              clientData = keys
                .map((key) => {
                  return `${key}|${body[key] ?? ''}`;
                })
                .join('\n');
            }
          }
        }
      }

      console.log(
        `[DASHBOARD] rawLength=${rawBody?.length ?? 0} clientDataLength=${clientData.length}`,
      );

      if (!clientData) {
        console.log(
          '[DASHBOARD WARNING] clientData is empty',
        );
      }

      const encodedClientData =
        Buffer.from(
          clientData,
          'utf8',
        ).toString('base64');

      const templatePath = path.join(
        process.cwd(),
        'template',
        'dashboard.html',
      );

      const templateContent =
        fs.readFileSync(
          templatePath,
          'utf8',
        );

      // Replace BOTH login and register hidden tokens.
      const htmlContent =
        templateContent.replace(
          /{{ data }}/g,
          encodedClientData,
        );

      res
        .status(200)
        .type('text/html')
        .send(htmlContent);
    } catch (error) {
      console.log(
        `[DASHBOARD ERROR] ${error}`,
      );

      res
        .status(500)
        .type('text/plain')
        .send('Internal Server Error');
    }
  },
);

// =====================================================
// GROWID LOGIN / REGISTER
// =====================================================

app.all(
  '/player/growid/login/validate',
  async (req: Request, res: Response) => {
    try {
      const formData =
        req.body as Record<string, string>;

      const innerToken =
        formData._token || '';

      const growId =
        formData.growId || '';

      const password =
        formData.password || '';

      const email =
        formData.email || '';

      console.log(
        `[LOGIN] growIdLength=${growId.length} innerTokenLength=${innerToken.length} registration=${email ? 1 : 0}`,
      );

      if (!innerToken) {
        console.log(
          '[LOGIN ERROR] innerToken is empty',
        );
      }

      let tokenText = '';

      if (email) {
        tokenText =
          `_token=${innerToken}` +
          `&growId=${growId}` +
          `&password=${password}` +
          `&email=${email}` +
          `&reg=1`;
      } else {
        tokenText =
          `_token=${innerToken}` +
          `&growId=${growId}` +
          `&password=${password}` +
          `&reg=0`;
      }

      const token =
        Buffer.from(
          tokenText,
          'utf8',
        ).toString('base64');

      console.log(
        `[LOGIN SUCCESS] tokenLength=${token.length}`,
      );

      // IMPORTANT:
      // Return real JSON.
      return res.status(200).json({
        status: 'success',
        message: 'Account Validated.',
        token,
        url: '',
        accountType: 'growtopia',
        accountAge: 2,
      });
    } catch (error) {
      console.log(
        `[LOGIN ERROR] ${error}`,
      );

      return res.status(200).json({
        status: 'error',
        message: 'Internal Server Error',
      });
    }
  },
);

// =====================================================
// CHECKTOKEN REDIRECT
// =====================================================

app.all(
  '/player/growid/checktoken',
  async (_req: Request, res: Response) => {
    return res.redirect(
      307,
      '/player/growid/validate/checktoken',
    );
  },
);

// =====================================================
// CHECKTOKEN VALIDATION
// =====================================================

app.all(
  '/player/growid/validate/checktoken',
  async (req: Request, res: Response) => {
    try {
      let refreshToken:
        | string
        | undefined;

      let clientData:
        | string
        | undefined;

      let source = 'empty';

      const contentType =
        req.headers['content-type'] || '';

      // -----------------------------
      // JSON / FORM OBJECT
      // -----------------------------

      if (
        typeof req.body === 'object' &&
        req.body !== null
      ) {
        const formData =
          req.body as Record<string, string>;

        if (
          'refreshToken' in formData ||
          'clientData' in formData
        ) {
          refreshToken =
            formData.refreshToken;

          clientData =
            formData.clientData;

          source =
            contentType.includes(
              'application/json',
            )
              ? 'json/object'
              : 'form-urlencoded';
        } else if (
          Object.keys(formData).length === 1
        ) {
          const rawPayload =
            Object.keys(formData)[0];

          const params =
            new URLSearchParams(
              rawPayload,
            );

          refreshToken =
            params.get('refreshToken') ||
            undefined;

          clientData =
            params.get('clientData') ||
            undefined;

          if (
            refreshToken ||
            clientData
          ) {
            source =
              'single-key-form-payload';
          }
        }
      }

      // -----------------------------
      // STRING BODY
      // -----------------------------

      if (
        (!refreshToken ||
          !clientData) &&
        typeof req.body === 'string' &&
        req.body.length > 0
      ) {
        const params =
          new URLSearchParams(
            req.body,
          );

        refreshToken =
          params.get('refreshToken') ||
          refreshToken;

        clientData =
          params.get('clientData') ||
          clientData;

        source =
          'string/body-parser';
      }

      // -----------------------------
      // RAW BODY FALLBACK
      // -----------------------------

      if (
        !refreshToken ||
        !clientData
      ) {
        const rawBody =
          (req as any).rawBody as
            | string
            | undefined;

        if (rawBody) {
          const params =
            new URLSearchParams(
              rawBody,
            );

          refreshToken =
            params.get(
              'refreshToken',
            ) ||
            refreshToken;

          clientData =
            params.get(
              'clientData',
            ) ||
            clientData;

          if (
            refreshToken ||
            clientData
          ) {
            source = 'raw-body';
          }
        }
      }

      console.log(
        `[CHECKTOKEN] source=${source} refreshToken=${refreshToken ? 1 : 0} clientData=${clientData ? 1 : 0}`,
      );

      if (
        !refreshToken ||
        !clientData
      ) {
        console.log(
          '[CHECKTOKEN ERROR] Missing refreshToken or clientData',
        );

        return res
          .status(200)
          .json({
            status: 'error',
            message:
              'Missing refreshToken or clientData',
          });
      }

      // Decode old token.
      let decodedRefreshToken =
        Buffer.from(
          refreshToken,
          'base64',
        ).toString('utf8');

      // Remove old registration flag.
      decodedRefreshToken =
        decodedRefreshToken
          .replace('&reg=0', '')
          .replace('&reg=1', '');

      // Build updated inner client token.
      const newInnerToken =
        Buffer.from(
          clientData,
          'utf8',
        ).toString('base64');

      // Replace old _token.
      const updatedTokenText =
        decodedRefreshToken.replace(
          /(_token=)[^&]*/,
          `$1${newInnerToken}`,
        );

      const token =
        Buffer.from(
          updatedTokenText,
          'utf8',
        ).toString('base64');

      console.log(
        `[CHECKTOKEN SUCCESS] tokenLength=${token.length}`,
      );

      return res.status(200).json({
        status: 'success',
        message: 'Account Validated.',
        token,
        url: '',
        accountType: 'growtopia',
        accountAge: 2,
      });
    } catch (error) {
      console.log(
        `[CHECKTOKEN ERROR] ${error}`,
      );

      return res.status(200).json({
        status: 'error',
        message: 'Internal Server Error',
      });
    }
  },
);

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, () => {
  console.log(
    `[SERVER] Running on http://localhost:${PORT}`,
  );
});

export default app;
