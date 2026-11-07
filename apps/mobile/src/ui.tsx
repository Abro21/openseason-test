import { ApiError } from '@openseason/api-client';
import { statusLabel, statusTone, type ActionStatus } from '@openseason/domain';
import { colors, radius, space, toneColors, touch, type as typeScale, type SemanticColors, type StatusTone } from '@openseason/tokens';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View, useColorScheme, type TextStyle, type ViewStyle } from 'react-native';

export function useColors(): SemanticColors {
  return colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

const font = (k: keyof typeof typeScale): TextStyle => ({ fontSize: typeScale[k].size, lineHeight: typeScale[k].lineHeight, fontWeight: typeScale[k].weight as TextStyle['fontWeight'] });

export function T({ children, kind = 'body', muted, style }: { children: ReactNode; kind?: keyof typeof typeScale; muted?: boolean; style?: TextStyle }) {
  const c = useColors();
  return <Text style={[font(kind), { color: muted ? c.textMuted : c.text }, style]}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return <View style={[{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: radius.lg, padding: space[4], marginBottom: space[3], gap: space[2] }, style]}>{children}</View>;
}

export function Badge({ tone, text }: { tone: StatusTone; text: string }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const { fg, bg } = toneColors(scheme, tone);
  return <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: space[2], paddingVertical: 2, alignSelf: 'flex-start' }}><Text style={[font('caption'), { color: fg }]}>{text}</Text></View>;
}

export const ActionBadge = ({ status }: { status: string }) => <Badge tone={statusTone(status as ActionStatus)} text={statusLabel(status as ActionStatus) ?? status} />;

export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.kind === 'conflict') return 'This changed since you opened it. Pull to refresh.';
    if (e.kind === 'forbidden') return "You don't have access to this.";
    if (e.kind === 'network') return 'Could not reach the server.';
    if (e.kind === 'unauthenticated') return 'Please sign in again.';
    return e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong.';
}

/** A 44pt+ button that runs once per press and reports failure beside itself. */
export function Button({ title, onPress, variant = 'default', disabled, accessibilityLabel }: {
  title: string; onPress: () => Promise<unknown> | void; variant?: 'default' | 'primary' | 'danger'; disabled?: boolean; accessibilityLabel?: string;
}) {
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bg = variant === 'primary' ? c.accent : c.surface;
  const fg = variant === 'primary' ? c.textOnAccent : variant === 'danger' ? c.danger : c.text;
  return (
    <View style={{ gap: 4 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} accessibilityState={{ disabled: disabled || busy, busy }}
        disabled={disabled || busy}
        onPress={async () => { setBusy(true); setError(null); try { await onPress(); } catch (e) { setError(describeError(e)); } finally { setBusy(false); } }}
        style={({ pressed }) => ({ minHeight: touch.minTarget, minWidth: touch.minTarget, paddingHorizontal: space[4], borderRadius: radius.md, justifyContent: 'center', alignItems: 'center',
          backgroundColor: pressed && variant === 'primary' ? c.accentPressed : bg, borderWidth: 1, borderColor: variant === 'danger' ? c.danger : variant === 'primary' ? c.accent : c.borderStrong, opacity: disabled ? 0.55 : 1 })}>
        {busy ? <ActivityIndicator color={fg} /> : <Text style={[font('label'), { color: fg }]}>{title}</Text>}
      </Pressable>
      {error && <Text accessibilityRole="alert" style={[font('caption'), { color: c.danger }]}>{error}</Text>}
    </View>
  );
}

export type Loadable<T> = { state: 'loading' } | { state: 'error'; error: unknown } | { state: 'ready'; data: T };

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): [Loadable<T>, () => void] {
  const [v, setV] = useState<Loadable<T>>({ state: 'loading' });
  const seq = useRef(0);
  const run = useCallback(fn, deps);
  const reload = useCallback(() => {
    const mine = ++seq.current;
    run().then((data) => mine === seq.current && setV({ state: 'ready', data }), (error) => mine === seq.current && setV({ state: 'error', error }));
  }, [run]);
  useEffect(() => { setV({ state: 'loading' }); reload(); }, [reload]);
  return [v, reload];
}

export function Show<T>({ value, children }: { value: Loadable<T>; children: (d: T) => ReactNode }) {
  const c = useColors();
  if (value.state === 'loading') return <ActivityIndicator accessibilityLabel="Loading" />;
  if (value.state === 'error') return <Text accessibilityRole="alert" style={{ color: c.danger }}>{describeError(value.error)}</Text>;
  return <>{children(value.data)}</>;
}

export const money = (cents: number, cur = 'usd') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase() }).format(cents / 100);
export const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
