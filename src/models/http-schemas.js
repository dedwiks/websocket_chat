module.exports = {
  register: {
    type: "object",
    additionalProperties: false,
    required: ["username", "password"],
    properties: {
      username: { type: "string", minLength: 3, maxLength: 50 },
      password: { type: "string", minLength: 8, maxLength: 128 }
    }
  },
  login: {
    type: "object",
    additionalProperties: false,
    required: ["username", "password"],
    properties: {
      username: { type: "string", minLength: 3, maxLength: 50 },
      password: { type: "string", minLength: 8, maxLength: 128 }
    }
  },
  refresh: {
    type: "object",
    additionalProperties: false,
    required: ["refresh_token"],
    properties: {
      refresh_token: { type: "string", minLength: 20 }
    }
  },
  directConversation: {
    type: "object",
    additionalProperties: false,
    required: ["userId"],
    properties: {
      userId: { type: "string", minLength: 36, maxLength: 36, pattern: "^[0-9a-fA-F-]{36}$" }
    }
  }
};
