// Set test environment before requiring the app
process.env.NODE_ENV = 'test';

const request = require("supertest");
const app = require("./server");

describe("API Tests", () => {
  it("GET /", async () => {
    const response = await request(app).get("/");
    expect(response.status).toBe(200);
    expect(response.body.service).toBe("my-node-app");
    expect(response.body.status).toBe("running");
  });

  it("GET /health", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.text).toBe("OK");
  });

  it("GET /config", async () => {
    const response = await request(app).get("/config");
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("mySecret");
    expect(response.body).toHaveProperty("timestamp");
    // In test mode, should return fallback value
    expect(response.body.mySecret).toBe("TEST_SECRET_VALUE");
  });

  it("GET /secret-info", async () => {
    const response = await request(app).get("/secret-info");
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("value");
    expect(response.body.value).toBe("TEST_SECRET_VALUE");
  });

  it("GET /trigger-reload", async () => {
    const response = await request(app).get("/trigger-reload");
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("message");
    expect(response.body).toHaveProperty("timestamp");
  });
});