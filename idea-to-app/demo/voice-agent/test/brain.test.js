// One test per acceptance check, named after the check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reply, INITIAL, findPhone, findName, findDay, spaced } from '../public/lib/brain.js';
import { business } from '../public/lib/business.js';

const say = (text, state = INITIAL) => reply(state, text, business);

test('check 1 — asking the opening hours gets the opening hours spoken back', () => {
  for (const phrasing of ['what time do you open', 'When do you open?', 'are you open saturday', 'what are your hours']) {
    const out = say(phrasing);
    assert.equal(out.action, 'answer', `"${phrasing}" should be answered`);
    assert.equal(out.say, business.hours);
  }
});

test('check 1 — location and price questions are answered too', () => {
  assert.equal(say('where are you located').say, business.location);
  assert.equal(say('whereabouts do you cover').say, business.location);
  assert.equal(say('how much does it cost').say, business.price);
  assert.equal(say('what do you charge').say, business.price);
});

test('check 2 — something it does not know gets a message, never a guess', () => {
  for (const phrasing of ['do you do roof tiling', 'can you rewire my shed', 'is Dave any good at tiling']) {
    const out = say(phrasing);
    assert.equal(out.action, 'message', `"${phrasing}" must not be answered`);
    assert.match(out.say, /take a message/);
    // The guarantee behind the check: no business fact leaked into the reply.
    assert.doesNotMatch(out.say, /ninety dollars|Parramatta|seven in the morning/);
  }
});

test('check 3 — a booking asks for name, then number, one at a time', () => {
  const first = say('book me in for tuesday');
  assert.equal(first.state.stage, 'awaiting_name');
  assert.match(first.say, /name/i);
  assert.equal(first.state.draft.day, 'Tuesday', 'the day it already heard is not asked for again');

  const second = say('my name is Rajesh', first.state);
  assert.equal(second.state.stage, 'awaiting_phone');
  assert.match(second.say, /number/i);
  assert.doesNotMatch(second.say, /name/i, 'it must not ask two things at once');
});

test('check 4 — a name and number produce a booking, read back', () => {
  let state = INITIAL, last;
  for (const line of ['can you come out thursday', 'Rajesh', '0412 345 678']) {
    last = reply(state, line, business); state = last.state;
  }
  assert.equal(last.action, 'booked');
  assert.deepEqual(last.booking, { name: 'Rajesh', phone: '0412345678', day: 'Thursday' });
  assert.match(last.say, /Rajesh/);
  assert.match(last.say, /Thursday/);
  assert.match(last.say, /0412 345 678/, 'the number is read back the way an Australian says it');
  assert.equal(last.state.stage, 'idle', 'it is ready for the next caller');
});

test('a booking with no day given asks for the day', () => {
  let s = reply(INITIAL, 'I need an appointment', business).state;
  s = reply(s, 'Dave', business).state;
  const out = reply(s, '0400111222', business);
  assert.equal(out.state.stage, 'awaiting_day');
  assert.match(out.say, /day/i);
});

test('a number that is too short is asked for again, not accepted', () => {
  let s = reply(INITIAL, 'book me in friday', business).state;
  s = reply(s, 'Sam', business).state;
  const out = reply(s, 'um 123', business);
  assert.equal(out.state.stage, 'awaiting_phone');
  assert.match(out.say, /eight digits/);
});

test('the caller can back out at any point', () => {
  const s = reply(INITIAL, 'book me in monday', business).state;
  const out = reply(s, 'actually never mind', business);
  assert.equal(out.action, 'cancelled');
  assert.deepEqual(out.state.draft, {});
});

test('silence or an empty transcript does not crash or advance', () => {
  const out = say('');
  assert.equal(out.action, 'retry');
  assert.equal(out.state.stage, 'idle');
});

test('helpers', () => {
  assert.equal(findPhone('0412 345 678'), '0412345678');
  assert.equal(findPhone('call me on 123'), null);
  assert.equal(findName("it's Rajesh"), 'Rajesh');
  assert.equal(findName('my name is anna maria'), 'Anna Maria');
  assert.equal(findDay('how about wednesday'), 'Wednesday');
  assert.equal(findDay('whenever'), null);
  assert.equal(spaced('0412345678'), '0412 345 678');
  assert.equal(spaced('0298765432'), '02 9876 5432');
  assert.equal(spaced('131450'), '131 450');
});
