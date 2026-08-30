import type { JSX, ReactNode } from 'react';

export function PlaceholderPanel({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <section className="rounded border border-dashed bg-white p-6 text-center">
      <h2 className="mb-1 font-semibold">{title}</h2>
      <p className="text-sm text-neutral-500">{children ?? '该模块正在建设中，敬请期待。'}</p>
    </section>
  );
}
