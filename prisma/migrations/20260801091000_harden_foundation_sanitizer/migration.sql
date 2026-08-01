CREATE OR REPLACE FUNCTION foundation_sanitize_jsonb(input JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF input IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  CASE jsonb_typeof(input)
    WHEN 'object' THEN
      RETURN COALESCE((
        SELECT jsonb_object_agg(
          key,
          CASE
            WHEN lower(key) ~ '(chat|message|content|email|authorization|cookie|token|firebase|secret|password|credential)'
              THEN '"[REDACTED]"'::jsonb
            ELSE foundation_sanitize_jsonb(value)
          END
        )
        FROM jsonb_each(input)
      ), '{}'::jsonb);
    WHEN 'array' THEN
      RETURN COALESCE((
        SELECT jsonb_agg(foundation_sanitize_jsonb(value))
        FROM jsonb_array_elements(input)
      ), '[]'::jsonb);
    WHEN 'string' THEN
      IF trim(both '"' from input::text) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        OR trim(both '"' from input::text) ~* '^bearer[[:space:]]+[a-z0-9._~+/=-]+$'
        OR trim(both '"' from input::text) ~* '^[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+$'
      THEN
        RETURN '"[REDACTED]"'::jsonb;
      END IF;
      RETURN input;
    ELSE
      RETURN input;
  END CASE;
END;
$$;
