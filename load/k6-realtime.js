// Full user journey against the realtime service: guest, match, game, cards, chat.
// Never run this against production. It creates real accounts.
//   docker run --rm -i -e BASE_URL=http://HOST:4000 -e TARGET_VUS=500 grafana/k6 run - < load/k6-realtime.js
import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';
import ws from 'k6/ws';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:4000';
const TARGET_VUS = Number(__ENV.TARGET_VUS || 500);
const RAMP = __ENV.RAMP || '1m';
const HOLD = __ENV.HOLD || '2m';
const FLOW_TIMEOUT_MS = 120_000;
const WS_URL = `${BASE_URL.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;

const journeyCompleted = new Rate('journey_completed');
const socketConnected = new Rate('socket_connected');
const timeToMatch = new Trend('time_to_match', true);
const messageLatency = new Trend('chat_message_latency', true);
const serverErrors = new Counter('server_errors');

export const options = {
  scenarios: {
    journey: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: RAMP, target: TARGET_VUS },
        { duration: HOLD, target: TARGET_VUS },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '130s',
    },
  },
  thresholds: {
    socket_connected: ['rate>0.99'],
    journey_completed: ['rate>0.95'],
    chat_message_latency: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
  },
};

function answerFor(question) {
  switch (question.type) {
    case 'mc':
    case 'emoji':
      return { answer: Math.floor(Math.random() * 4) };
    case 'tf':
      return { answer: Math.random() < 0.5 ? 0 : 1 };
    case 'estimate':
      return { answer: Math.floor(Math.random() * 3000) };
    default:
      return {
        answer: Math.random() < 0.5 ? 'a' : 'b',
        prediction: Math.random() < 0.5 ? 'a' : 'b',
      };
  }
}

export default function journey() {
  const guest = http.post(`${BASE_URL}/api/guest`);
  if (!check(guest, { 'guest created': (response) => response.status === 201 })) {
    journeyCompleted.add(false);
    sleep(1);
    return;
  }
  const { token, user } = guest.json();
  const terms = http.post(`${BASE_URL}/api/me/accept-terms`, null, {
    headers: { Authorization: `Bearer ${token}` },
  });
  check(terms, { 'terms accepted': (response) => response.status === 200 });

  let connected = false;
  let completed = false;
  const queuedAt = Date.now();
  const sentAt = {};

  const response = ws.connect(WS_URL, {}, (socket) => {
    const emit = (event, payload) => socket.send(`42${JSON.stringify([event, payload])}`);

    const say = (index) => {
      const body = `yuk testi ${user.id.slice(-6)} ${index}`;
      sentAt[body] = Date.now();
      emit('chat:send', { body });
    };

    const handlers = {
      'match:found': () => timeToMatch.add(Date.now() - queuedAt),
      'round:start': ({ roundNo, question }) => {
        socket.setTimeout(
          () => emit('game:answer', { roundNo, ...answerFor(question) }),
          300 + Math.random() * 700,
        );
      },
      'cards:offer': ({ cards, pickCount }) => {
        socket.setTimeout(
          () => emit('cards:pick', { cardIds: cards.slice(0, pickCount).map((card) => card.id) }),
          300 + Math.random() * 700,
        );
      },
      'chat:start': () => {
        socket.setTimeout(() => say(1), 1_200);
        socket.setTimeout(() => say(2), 3_000);
        socket.setTimeout(() => say(3), 5_000);
        socket.setTimeout(() => emit('chat:leave', {}), 7_000);
      },
      'chat:message': ({ senderId, body }) => {
        if (senderId === user.id && sentAt[body]) messageLatency.add(Date.now() - sentAt[body]);
      },
      'chat:ended': () => {
        completed = true;
        socket.close();
      },
      error: ({ code }) => serverErrors.add(1, { code }),
    };

    socket.on('message', (raw) => {
      if (raw === '2') return socket.send('3');
      if (raw.startsWith('0')) return socket.send(`40${JSON.stringify({ token })}`);
      if (raw.startsWith('44')) return socket.close();
      if (raw.startsWith('40')) {
        connected = true;
        return emit('queue:join', {});
      }
      if (!raw.startsWith('42')) return undefined;
      const [event, payload] = JSON.parse(raw.slice(2));
      const handler = handlers[event];
      return handler ? handler(payload) : undefined;
    });
    socket.setTimeout(() => socket.close(), FLOW_TIMEOUT_MS);
  });

  check(response, { 'websocket opened': (result) => result && result.status === 101 });
  socketConnected.add(connected);
  journeyCompleted.add(completed);
  sleep(1);
}
