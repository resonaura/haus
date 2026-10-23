const messages = {
  update:
    'Update the Haus helper in Home Assistant to use server management, then refresh this page.',
  timeout:
    'Your server is taking longer to respond. Check that the Haus helper is running, then try again.',
  connection: 'Could not reach your servers. Check your connection and try again.',
  permission: 'Sign in with a home administrator account to manage your servers.',
  missing: 'This server is no longer available. Refresh your servers and try again.',
  retry: 'The request could not be completed. Refresh your servers and try again.',
};
const readableMessages = new Set(Object.values(messages));

function errorText(error: unknown) {
  let message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  // Electron adds this transport envelope to errors rejected by an IPC handler.
  for (let pass = 0; pass < 3; pass += 1) {
    const previous = message;
    message = message
      .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
      .replace(/^(?:Error|TypeError):\s*/i, '')
      .trim();
    if (message === previous) break;
  }
  return message.split('\n')[0].trim();
}

export function serverErrorMessage(
  error: unknown,
  { serverApi = false }: { serverApi?: boolean } = {},
) {
  const text = errorText(error);
  if (readableMessages.has(text)) return text;
  if (
    serverApi &&
    /^(?:not[ _-]?found|(?:HTTP\s*)?404(?:\b.*)?|unsupported(?:[ _-](?:service[ _-])?(?:operation|endpoint|api))?)$/i.test(
      text,
    )
  ) {
    return messages.update;
  }
  if (/timeout|timed out|deadline|aborterror|taking too long/i.test(text)) {
    return messages.timeout;
  }
  if (
    /failed to fetch|fetch failed|network|connection (?:lost|refused|closed)|ECONN|ENOTFOUND|EHOST|unreachable/i.test(
      text,
    )
  ) {
    return messages.connection;
  }
  if (/unauthori[sz]ed|forbidden|permission|(?:HTTP\s*)?40[13]\b/i.test(text)) {
    return messages.permission;
  }
  if (/^(?:not[ _-]?found|invalid[ _-]node|unknown[ _-](?:node|server))$/i.test(text)) {
    return messages.missing;
  }
  // Keep intentional, actionable app messages; unfamiliar server codes and paths
  // are not useful to someone managing their home.
  if (
    /^(?:Connect your home|Use the desktop app|Refresh your servers|The (?:new storage limit|updated server state)|Please try again)\b/.test(
      text,
    )
  )
    return text;
  return messages.retry;
}
