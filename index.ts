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
  max: 60,
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
// DASHBOARD
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

      if (rawBody && rawBody.length > 0) {
        if (
          contentType.includes(
            'application/x-www-form-urlencoded',
          )
        ) {
          try {
            const params = new URLSearchParams(rawBody);
            const entries = Array.from(params.entries());

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

      // Fallback
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
          '[DASHBOARD WARNING] clientData empty',
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

      const htmlContent =
        templateContent.replace(
          /{{ data }}/g,
          encodedClientData,
        );

      return res
        .status(200)
        .type('text/html')
        .send(htmlContent);
    } catch (error) {
      console.log(
        `[DASHBOARD ERROR] ${error}`,
      );

      return res
        .status(500)
        .type('text/plain')
        .send('Internal Server Error');
    }
  },
);

// =====================================================
// LOGIN VALIDATE
// POST = create token
// GET  = handoff/navigation test
// =====================================================

app.all(
  '/player/growid/login/validate',
  async (req: Request, res: Response) => {
    try {
      // ---------------------------------------------
      // EXPERIMENT 2:
      // GET handoff after dashboard fetch()
      // ---------------------------------------------

      if (
        req.method === 'GET' &&
        typeof req.query.token === 'string'
      ) {
        const token = req.query.token;

        console.log(
          `[LOGIN GET HANDOFF] tokenLength=${token.length}`,
        );

        res.setHeader(
          'Cache-Control',
          'no-store',
        );

return res
  .status(200)
  .type('text/html')
  .send(
    JSON.stringify({
      status: 'success',
      message: 'Account Validated.',
      token,
      url: '',
      accountType: 'growtopia',
    }),
  );
      }

      // ---------------------------------------------
      // NORMAL POST LOGIN
      // ---------------------------------------------

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
        `[LOGIN POST] growIdLength=${growId.length} innerTokenLength=${innerToken.length} registration=${email ? 1 : 0}`,
      );

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
        `[LOGIN POST SUCCESS] tokenLength=${token.length}`,
      );

      res.setHeader(
        'Cache-Control',
        'no-store',
      );

return res
  .status(200)
  .type('text/html')
  .send(
    JSON.stringify({
      status: 'success',
      message: 'Account Validated.',
      token,
      url: '',
      accountType: 'growtopia',
    }),
  );
    } catch (error) {
      console.log(
        `[LOGIN ERROR] ${error}`,
      );

      return res
        .status(500)
        .json({
          status: 'error',
          message:
            'Internal Server Error',
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
    console.log(
      '[CHECKTOKEN REDIRECT]',
    );

    return res.redirect(
      307,
      '/player/growid/validate/checktoken',
    );
  },
);

// =====================================================
// CHECKTOKEN VALIDATE
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

      // ---------------------------------------------
      // OBJECT BODY
      // ---------------------------------------------

      if (
        typeof req.body === 'object' &&
        req.body !== null
      ) {
        const formData =
          req.body as Record<string, string>;

        refreshToken =
          formData.refreshToken ||
          formData.refresh_token ||
          formData.token;

        clientData =
          formData.clientData ||
          formData.client_data ||
          formData._token;

        if (
          refreshToken ||
          clientData
        ) {
          source =
            contentType.includes(
              'application/json',
            )
              ? 'json/object'
              : 'form-urlencoded';
        }

        // Some clients may send the whole payload as one key.
        if (
          (!refreshToken ||
            !clientData) &&
          Object.keys(formData).length === 1
        ) {
          const rawPayload =
            Object.keys(formData)[0];

          const params =
            new URLSearchParams(
              rawPayload,
            );

          refreshToken =
            params.get(
              'refreshToken',
            ) ||
            params.get(
              'refresh_token',
            ) ||
            params.get('token') ||
            refreshToken;

          clientData =
            params.get(
              'clientData',
            ) ||
            params.get(
              'client_data',
            ) ||
            params.get('_token') ||
            clientData;

          source =
            'single-key-form-payload';
        }
      }

      // ---------------------------------------------
      // STRING BODY
      // ---------------------------------------------

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
          params.get(
            'refreshToken',
          ) ||
          params.get(
            'refresh_token',
          ) ||
          params.get('token') ||
          refreshToken;

        clientData =
          params.get(
            'clientData',
          ) ||
          params.get(
            'client_data',
          ) ||
          params.get('_token') ||
          clientData;

        source =
          'string-body';
      }

      // ---------------------------------------------
      // RAW BODY
      // ---------------------------------------------

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
            params.get(
              'refresh_token',
            ) ||
            params.get('token') ||
            refreshToken;

          clientData =
            params.get(
              'clientData',
            ) ||
            params.get(
              'client_data',
            ) ||
            params.get('_token') ||
            clientData;

          if (
            refreshToken ||
            clientData
          ) {
            source =
              'raw-body';
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
        return res
          .status(200)
          .json({
            status: 'error',
            message:
              'Missing refreshToken or clientData',
          });
      }

      // ---------------------------------------------
      // DECODE EXISTING OUTER TOKEN
      // ---------------------------------------------

      let decodedRefreshToken =
        Buffer.from(
          refreshToken,
          'base64',
        ).toString('utf8');

      decodedRefreshToken =
        decodedRefreshToken
          .replace('&reg=0', '')
          .replace('&reg=1', '');

      // ---------------------------------------------
      // UPDATE INNER CLIENT DATA
      // ---------------------------------------------

      const newInnerToken =
        Buffer.from(
          clientData,
          'utf8',
        ).toString('base64');

      let updatedTokenText =
        decodedRefreshToken;

      if (
        /_token=[^&]*/.test(
          updatedTokenText,
        )
      ) {
        updatedTokenText =
          updatedTokenText.replace(
            /(_token=)[^&]*/,
            `$1${newInnerToken}`,
          );
      }

      const token =
        Buffer.from(
          updatedTokenText,
          'utf8',
        ).toString('base64');

      console.log(
        `[CHECKTOKEN SUCCESS] tokenLength=${token.length}`,
      );

      res.setHeader(
        'Cache-Control',
        'no-store',
      );

      return res
        .status(200)
        .json({
          status: 'success',
          message: 'Token is valid.',
          token,
          url: '',
          accountType: 'growtopia',
          accountAge: 2,
        });
    } catch (error) {
      console.log(
        `[CHECKTOKEN ERROR] ${error}`,
      );

      return res
        .status(200)
        .json({
          status: 'error',
          message:
            'Internal Server Error',
        });
    }
  },
);

// =====================================================
// START
// =====================================================

app.listen(PORT, () => {
  console.log(
    `[SERVER] Running on http://localhost:${PORT}`,
  );
});

export default app;
