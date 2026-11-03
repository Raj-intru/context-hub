import { bookings } from '../src/handlers.js';

export default function handler(req, res) {
  const out = bookings(req.method, req.body);
  res.status(out.status).json(out.json);
}
