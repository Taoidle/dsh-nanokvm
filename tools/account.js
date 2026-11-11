/**
 * Account tools: who the box thinks it is talking to, and the password change
 * that also drops every session on the box.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { PLAIN_OUTPUT } from '../lib/output.js';
import { NanoKvmError, annotateDeviceError } from '../lib/device.js';

const DEVICE_PARAM = {
  type: 'string',
  description: 'NanoKVM device to work with: a name from the `devices` list in the plugin settings. Omit for the default device.',
};


/**
 * The account tool.
 * @param {{pool: object}} deps the plugin dependencies.
 * @returns {object[]} the tool definitions.
 */
export function accountTools(deps) {
  return [
    {
      name: 'nanokvm_account',
      description:
        "Read the account the box is serving, or change its web password. `info` returns the username, role and " +
        'permissions. `password` needs both the current and the new password; the box checks the current one, ' +
        'stores the new one and drops every session, so this plugin logs in again on the next call.',
      parameters: {
        device: DEVICE_PARAM,
        action: { type: 'string', enum: ['info', 'password'], description: 'What to do (default info).' },
        current: { type: 'string', description: 'For password: the password in use now.' },
        password: { type: 'string', description: 'For password: the new password.' },
      },
      output: PLAIN_OUTPUT,
      timeoutMs: 60000,
      async execute(args) {
        const target = deps.pool.target(args.device);
        const action = String(args.action ?? 'info');
        try {
          if (action === 'info') return { device: target.name, account: await target.client.account() };
          const current = String(args.current ?? '');
          const next = String(args.password ?? '');
          if (current === '') throw new NanoKvmError('the box needs the current password to change it');
          if ([...next].length < 8) throw new NanoKvmError('the new password must be at least 8 characters');
          return { device: target.name, ok: true, result: await target.client.changePassword({ current, next }) };
        } catch (error) {
          throw annotateDeviceError(error, target.name);
        }
      },
    },
  ];
}
