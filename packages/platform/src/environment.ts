try {
  process.loadEnvFile(process.env.CRISPY_FACTORY_ENV ?? ".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

export {};
