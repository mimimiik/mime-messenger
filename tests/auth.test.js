const request = require('supertest');
const app = require('../server');
const User = require('../models/User');

describe('Auth Endpoints', () => {
  beforeEach(async () => {
    await User.deleteMany({});
  });

  test('POST /auth/register – успешная регистрация', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ username: 'testuser', password: '123456', displayName: 'Test User' });
    expect(res.statusCode).toBe(200);
    expect(res.body.username).toBe('testuser');
  });

  test('POST /auth/register – дубликат username', async () => {
    await request(app).post('/auth/register').send({ username: 'testuser', password: '123456' });
    const res = await request(app).post('/auth/register').send({ username: 'testuser', password: '123456' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Username taken/);
  });

  test('POST /auth/login – успешный вход', async () => {
    await request(app).post('/auth/register').send({ username: 'testuser', password: '123456' });
    const res = await request(app).post('/auth/login').send({ username: 'testuser', password: '123456' });
    expect(res.statusCode).toBe(200);
    expect(res.body.username).toBe('testuser');
  });
});