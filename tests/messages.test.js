const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Chat = require('../models/Chat');

describe('Messages Endpoints', () => {
  let user1, user2, agent1, agent2;

  beforeEach(async () => {
    await User.deleteMany({});
    await Chat.deleteMany({});
    user1 = await request(app).post('/auth/register').send({ username: 'user1', password: '123' });
    user2 = await request(app).post('/auth/register').send({ username: 'user2', password: '123' });
    agent1 = request.agent(app);
    agent2 = request.agent(app);
    await agent1.post('/auth/login').send({ username: 'user1', password: '123' });
    await agent2.post('/auth/login').send({ username: 'user2', password: '123' });
  });

  test('GET /messages/chat/:userId – пустой чат', async () => {
    const res = await agent1.get(`/messages/chat/${user2.body.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]);
  });
});