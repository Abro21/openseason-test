// The whole web app in sandbox mode: real session, sign-in and screens over the
// in-browser database. jsdom has no IndexedDB, so the sandbox runs in memory here.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, describe, expect, it, vi } from 'vitest';

// jsdom's Blob lacks arrayBuffer(), which PGlite uses to unpack the pgcrypto extension. Browsers have it.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(this);
    });
  };
}

vi.stubEnv('VITE_SANDBOX', 'browser');
vi.mock('./browser', async (importOriginal) => {
  const real = await importOriginal<typeof import('./browser')>();
  return { ...real, openSandbox: () => real.openSandbox({ dataDir: 'memory://' }) };
});

const { App } = await import('../App');
const { getSandbox, SessionProvider } = await import('../session');

afterAll(async () => {
  cleanup();
  await (await getSandbox()).close();
});

describe('web app on the in-browser sandbox', () => {
  it('signs in as a parent in two clubs, switches between their children, and pays a fee', async () => {
    render(<SessionProvider><App /></SessionProvider>);
    fireEvent.click(await screen.findByRole('button', { name: /Sign in as Pat Parent/ }, { timeout: 30_000 }));
    expect(await screen.findByText(/synthetic data that lives only in this browser/, {}, { timeout: 10_000 })).toBeTruthy();
    const role = await screen.findByLabelText('Role', {}, { timeout: 10_000 });
    expect(Array.from((role as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(['Parent']);
    const child = screen.getByLabelText('Child') as HTMLSelectElement;
    const labels = Array.from(child.options).map((o) => o.textContent);
    expect(labels).toEqual(['Leo L. · Front Range FC', 'Mia L. · Front Range FC', 'Nora L. · Mesa Valley SC']);
    fireEvent.click(await screen.findByRole('button', { name: 'Payments' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Pay installment/ }).length).toBeGreaterThan(0), { timeout: 10_000 });
    const before = screen.getAllByRole('button', { name: /Pay installment/ }).length;

    fireEvent.click(screen.getAllByRole('button', { name: /Pay installment/ })[0]!);
    expect(await screen.findByText('No card is collected and no money moves.', { exact: false }, { timeout: 10_000 })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Simulate success' }));
    expect(await screen.findByText('Sandbox payment recorded as paid.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to OpenSeason' }));
    await waitFor(() => expect(screen.queryAllByRole('button', { name: /Pay installment/ }).length).toBe(before - 1), { timeout: 10_000 });
  }, 60_000);
});
