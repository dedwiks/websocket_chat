module.exports = {
  auth: {
    type: "object",
    additionalProperties: true, // Allow frontend variations like sending other fields alongside token
    required: ["type"],
    properties: {
      type: { const: "auth" },
      jwt: { type: "string", minLength: 10 }
    }
  },
  join_conversation: {
    type: "object",
    additionalProperties: false,
    required: ["type", "cid"],
    properties: {
      type: { const: "join_conversation" },
      cid: { type: "string", minLength: 36, maxLength: 36, pattern: "^[0-9a-fA-F-]{36}$" }
    }
  },
  send_message: {
    type: "object",
    additionalProperties: false,
    required: ["type", "cid", "client_id", "msg"],
    properties: {
      type: { const: "send_message" },
      cid: { type: "string", minLength: 36, maxLength: 36, pattern: "^[0-9a-fA-F-]{36}$" },
      client_id: { type: "string", minLength: 36, maxLength: 36, pattern: "^[0-9a-fA-F-]{36}$" },
      msg: { type: "string", minLength: 1, maxLength: 2000 }
    }
  },
  typing: {
    type: "object",
    additionalProperties: false,
    required: ["type", "cid"],
    properties: {
      type: { const: "typing" },
      cid: { type: "string", minLength: 36, maxLength: 36, pattern: "^[0-9a-fA-F-]{36}$" }
    }
  },
  pong: {
    type: "object",
    additionalProperties: false,
    required: ["type"],
    properties: {
      type: { const: "pong" }
    }
  }
};
