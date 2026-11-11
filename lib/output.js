/**
 * The output shape shared by the tools that return plain data.
 *
 * A tool's output must declare both halves: the schema the value is validated
 * against, and the renderer that turns it into conversation content. JSON is the
 * honest rendering for a device report — every field the box gave us, nothing
 * invented.
 */
export const PLAIN_OUTPUT = {
  schema: { type: 'object', additionalProperties: true, properties: {} },
  render: (args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
};
