import { describe, it, expect } from 'vitest';
import { Mutex } from './mutex.js';

describe('Mutex', () => {
  it('executes tasks sequentially and prevents race conditions', async () => {
    const mutex = new Mutex();
    const results: number[] = [];

    const task1 = mutex.runExclusive(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      results.push(1);
      return 'task1';
    });

    const task2 = mutex.runExclusive(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      results.push(2);
      return 'task2';
    });

    const task3 = mutex.runExclusive(async () => {
      results.push(3);
      return 'task3';
    });

    const [r1, r2, r3] = await Promise.all([task1, task2, task3]);

    expect(r1).toBe('task1');
    expect(r2).toBe('task2');
    expect(r3).toBe('task3');
    expect(results).toEqual([1, 2, 3]);
  });

  it('releases lock even if task throws an error', async () => {
    const mutex = new Mutex();
    let secondTaskExecuted = false;

    const failingTask = mutex.runExclusive(async () => {
      throw new Error('boom');
    });

    const subsequentTask = mutex.runExclusive(async () => {
      secondTaskExecuted = true;
      return 42;
    });

    await expect(failingTask).rejects.toThrow('boom');
    const result = await subsequentTask;
    expect(secondTaskExecuted).toBe(true);
    expect(result).toBe(42);
  });

  it('supports manual acquire and release', async () => {
    const mutex = new Mutex();
    const sequence: string[] = [];

    const release1 = await mutex.acquire();
    sequence.push('acquired1');

    const task2 = mutex.runExclusive(async () => {
      sequence.push('task2');
    });

    sequence.push('beforeRelease1');
    release1();

    await task2;
    expect(sequence).toEqual(['acquired1', 'beforeRelease1', 'task2']);
  });
});
