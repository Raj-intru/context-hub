import { usage } from '../src/handlers.js';

export default function handler(req, res) {
  const out = usage(req.method, req.body);
  res.status(out.status).json(out.json);
}
