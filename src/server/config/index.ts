export interface ServerConfig {
  port: number;
  token?: string;
  model: 'asi1-mini';
  timeoutMs: number;
}

const DEFAULT_PORT = 8787;

export const readServerConfig = (
  env: NodeJS.ProcessEnv = process.env,
): ServerConfig => {
  const parsedPort = Number(env.PORT);
  const token = env.SC_TOKEN?.trim();

  return {
    port:
      Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65_535
        ? parsedPort
        : DEFAULT_PORT,
    ...(token ? { token } : {}),
    model: 'asi1-mini',
    timeoutMs: 60_000,
  };
};
