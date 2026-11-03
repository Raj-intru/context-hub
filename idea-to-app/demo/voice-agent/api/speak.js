import { speak } from '../src/handlers.js';

export default async function handler(req, res) {
  const out = await speak(req.method, req.body);
  if (out.mp3) {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    return res.status(200).send(out.mp3);
  }
  return res.status(out.status).json(out.json);
}
