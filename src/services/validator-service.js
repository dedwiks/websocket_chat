const Ajv = require("ajv");

const ajv = new Ajv({
  allErrors: true
});

function compile(schemaMap) {
  return Object.fromEntries(
    Object.entries(schemaMap).map(([key, schema]) => [key, ajv.compile(schema)])
  );
}

function formatErrors(validator) {
  if (!validator.errors || validator.errors.length === 0) {
    return "Invalid payload";
  }
  return validator.errors.map((entry) => `${entry.instancePath || "/"} ${entry.message}`).join(", ");
}

module.exports = {
  compile,
  formatErrors
};
