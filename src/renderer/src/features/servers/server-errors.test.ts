import { describe, expect, it } from 'vitest';
import { serverErrorMessage } from './server-errors';

describe('friendly server errors', () => {
  it('explains an older helper without exposing Electron or endpoint details', () => {
    const error = new Error("Error invoking remote method 'haus:helper': Error: not found");
    expect(serverErrorMessage(error, { serverApi: true })).toBe(
      'Update the Haus helper in Home Assistant to use server management, then refresh this page.',
    );
    for (const message of [
      '404',
      'HTTP 404 Not Found',
      'unsupported_service_operation',
      'unsupported_endpoint',
    ]) {
      expect(serverErrorMessage(new Error(message), { serverApi: true })).toContain(
        'Update the Haus helper',
      );
    }
  });
  it('does not mistake a missing paired server for a helper update requirement', () => {
    expect(
      serverErrorMessage(new Error("Error invoking remote method 'haus:helper': Error: not found")),
    ).toBe('This server is no longer available. Refresh your servers and try again.');
  });
  it('unwraps nested IPC failures and preserves intentional confirmation guidance', () => {
    const text = 'The new storage limit has not been confirmed. Refresh servers and try again.';
    expect(
      serverErrorMessage(new Error(`Error invoking remote method "haus:helper": Error: ${text}`)),
    ).toBe(text);
  });
  it('offers a useful retry for connectivity failures without exposing a private address', () => {
    const message = serverErrorMessage(
      new Error(
        "Error invoking remote method 'haus:helper': Error: connect ECONNREFUSED 192.168.1.20:8098",
      ),
    );
    expect(message).toBe('Could not reach your servers. Check your connection and try again.');
    expect(message).not.toContain('192.168');
  });
  it('turns timeouts and permission failures into clear next steps', () => {
    expect(serverErrorMessage(new Error('AbortError: request timed out'))).toContain(
      'Check that the Haus helper is running',
    );
    expect(serverErrorMessage(new Error('HTTP 403 Forbidden'))).toContain(
      'home administrator account',
    );
  });
  it('does not put unrecognized implementation codes, stacks or missing values in the UI', () => {
    for (const error of [
      new Error('helper_service_operation_invalid'),
      new Error('Error: /api/servers\n at server.mjs:42'),
      {},
      undefined,
    ]) {
      expect(serverErrorMessage(error)).toBe(
        'The request could not be completed. Refresh your servers and try again.',
      );
    }
  });
  it('preserves friendly guidance as errors pass through request and UI layers', () => {
    for (const reason of [
      'not found',
      'request timed out',
      'fetch failed',
      '403 Forbidden',
      'unexpected_code',
    ]) {
      const requestMessage = serverErrorMessage(new Error(reason), { serverApi: true });
      expect(serverErrorMessage(new Error(requestMessage))).toBe(requestMessage);
    }
  });
});
