// Where bookings live.
//
// In memory, on purpose. This runs on Vercel's functions, which have no disk
// that survives a request — but the bigger reason is in the decision log: a
// public demo link that permanently keeps every passer-by's name and phone
// number is a privacy liability nobody asked for. Bookings exist for the length
// of the demo and then they are gone, and the Trust Card says so.
//
// A real business swaps this file for a database. Nothing else changes.
const bookings = [];

export const list = () => bookings.slice();

export function add(row) {
  bookings.push(row);
  if (bookings.length > 50) bookings.shift();   // a demo link is a public inbox
  return row;
}
