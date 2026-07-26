import { Injectable } from '@nestjs/common';

@Injectable()
export class KeyedSerialExecutor {
  private readonly chains = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    const settled = current.finally(() => {
      if (this.chains.get(key) === settled) {
        this.chains.delete(key);
      }
    });

    this.chains.set(key, settled);
    return current;
  }

  async drain(): Promise<void> {
    while (this.chains.size > 0) {
      await Promise.allSettled([...this.chains.values()]);
    }
  }
}
