const MAX_LOG_LENGTH = 500;

function redactCredentials(value) {
  return value
    .replace(
      /\b(?:mysql|mariadb|mongodb(?:\+srv)?):\/\/[^\s/@]+@/gi,
      (match) => {
        const scheme = match.slice(0, match.indexOf("://") + 3);
        return `${scheme}REDACTED@`;
      }
    )
    .replace(
      /\b(?:authorization|proxy-authorization)\s*[:=]\s*[^\s,;]+/gi,
      "$&".replace(/[^:=]+$/,"REDACTED")
    )
    .replace(
      /\b(?:password|passwd|pwd|secret|token|api[_-]?key|private[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
      (match) => match.replace(/([:=]\s*)[^\s,;]+$/,"$1<REDACTED>")
    )
    .replace(/\bBearer\s+[^\s]+/gi, "Bearer <REDACTED>");
}

export function sanitizeLogValue(value, maxLength = MAX_LOG_LENGTH) {
  const normalized = redactCredentials(
    String(value ?? "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/[\x00-\x1F\x7F]/g, "")
      .trim()
  );

  return normalized.slice(0, maxLength);
}

export function sanitizeError(error) {
  return sanitizeLogValue(
    error instanceof Error ? error.message : String(error)
  );
}
