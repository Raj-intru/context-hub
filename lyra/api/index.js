// Vercel serverless entry. An Express app is itself a (req, res) handler, so we
// export it directly for @vercel/node. The same app runs persistently via
// `node src/server.js` on Railway/Render/Fly. Static files and all API routes
// are handled inside createApp().
import { createApp } from '../src/app.js';

export default createApp();
