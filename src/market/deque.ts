/**
 * Deque без аллокаций на горячем пути.
 *
 * Почему не Array.shift(): shift() пересобирает массив — O(n) на вызов.
 * Здесь удаление с головы это `head += 1`. Реальное удаление из массива
 * происходит раз в COMPACT_AT элементов, а не на каждый тик.
 *
 * Потребитель обязан сам следить за порядком: элементы добавляются и
 * удаляются строго с обоих концов.
 */
const COMPACT_AT = 1024;

export class Deque<T> {
  private readonly items: T[] = [];
  private head = 0;

  get size(): number {
    return this.items.length - this.head;
  }

  peekFront(): T | undefined {
    if (this.size === 0) return undefined;
    return this.items[this.head];
  }

  peekBack(): T | undefined {
    if (this.size === 0) return undefined;
    return this.items[this.items.length - 1];
  }

  pushBack(value: T): void {
    this.items.push(value);
  }

  clear(): void {
    this.items.length = 0;
    this.head = 0;
  }

  popBack(): T | undefined {
    if (this.size === 0) return undefined;
    const value = this.items.pop();
    if (this.items.length === this.head) {
      this.items.length = 0;
      this.head = 0;
    }
    return value;
  }

  shiftFront(): T | undefined {
    if (this.size === 0) return undefined;
    const value = this.items[this.head];
    this.head += 1;
    if (this.head >= COMPACT_AT && this.head * 2 >= this.items.length) {
      this.items.splice(0, this.head);
      this.head = 0;
    }
    return value;
  }

  *[Symbol.iterator](): Generator<T> {
    for (let i = this.head; i < this.items.length; i += 1) {
      const value = this.items[i];
      if (value !== undefined) yield value;
    }
  }
}
