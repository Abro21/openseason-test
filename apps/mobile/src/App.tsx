import type { AppContext } from '@openseason/domain';
import { space, touch } from '@openseason/tokens';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { Home, Messages, SignIn } from './screens';
import { scopeKey, SessionProvider, useSession } from './session';
import { Badge, Button, T, useColors } from './ui';

type Tab = 'home' | 'messages';
const ROLE_LABEL: Record<AppContext['kind'], string> = { club: 'Club Director', team: 'Coach', family: 'Parent', athlete: 'Player', fan: 'Fan' };

export function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}

function Shell() {
  const s = useSession();
  const c = useColors();
  const [tab, setTab] = useState<Tab>('home');
  const [picking, setPicking] = useState(false);
  const ctx = s.active;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <StatusBar style="auto" />
      <View style={{ padding: space[2], backgroundColor: c.sandboxSubtle }}><Text style={{ color: c.sandbox, fontSize: 12 }}>Sandbox: synthetic data, nothing real is sent or charged.</Text></View>
      {s.signedIn && ctx && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space[3], borderBottomWidth: 1, borderColor: c.border }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${ROLE_LABEL[ctx.kind]}, ${ctx.label}, ${s.tenant?.name ?? ''}. Change role or club`} onPress={() => setPicking(!picking)} style={{ minHeight: touch.minTarget, justifyContent: 'center' }}>
            <T kind="caption" muted>{ROLE_LABEL[ctx.kind]} · {s.tenant?.name}</T>
            <T kind="bodyStrong">{ctx.label} ▾</T>
          </Pressable>
          <Button title="Sign out" onPress={s.signOut} />
        </View>
      )}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space[4], gap: space[3] }}>
        {!s.ready ? null : !s.signedIn ? <SignIn /> : picking ? (
          <View style={{ gap: space[2] }}>
            <T kind="title">Switch role or club</T>
            {(['club', 'team', 'family', 'athlete', 'fan'] as const).filter((r) => s.scopes.some((x) => x.ctx.kind === r)).map((r) => (
              <View key={r} style={{ gap: space[2] }}>
                <T kind="label" muted>{ROLE_LABEL[r]}</T>
                {s.scopes.filter((x) => x.ctx.kind === r).map((x) => (
                  <Button key={scopeKey(x)} title={x.ctx.kind === 'club' ? x.ctx.label : `${x.ctx.label} · ${x.tenant.name}`}
                    variant={s.tenant && ctx && scopeKey({ tenant: s.tenant, ctx }) === scopeKey(x) ? 'primary' : 'default'}
                    onPress={() => { s.choose(x); setPicking(false); setTab('home'); }} />
                ))}
              </View>
            ))}
          </View>
        ) : !ctx ? (
          s.tenants ? <T>Not connected to a club, team or family yet. Ask your coach for an invite.</T> : <Badge tone="pending" text="Loading" />
        ) : (
          <View key={s.tenant ? scopeKey({ tenant: s.tenant, ctx }) : 'none'}>
            {tab === 'home' && <Home ctx={ctx} />}
            {tab === 'messages' && <Messages />}
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
      {s.signedIn && ctx && !picking && (
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
          {(['home', 'messages'] as Tab[]).map((t) => (
            <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => setTab(t)}
              style={{ flex: 1, minHeight: touch.minTarget + 12, alignItems: 'center', justifyContent: 'center', borderTopWidth: 3, borderColor: tab === t ? c.accent : 'transparent' }}>
              <T kind="label" muted={tab !== t}>{t === 'home' ? 'Home' : 'Messages'}</T>
            </Pressable>
          ))}
        </View>
      )}
    </SafeAreaView>
  );
}
