import { contextKey } from '@openseason/domain';
import { space, touch } from '@openseason/tokens';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { Home, Messages, SignIn, Staff } from './screens';
import { SessionProvider, useSession } from './session';
import { Badge, Button, T, useColors } from './ui';

type Tab = 'home' | 'staff' | 'messages';

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
  const staffTab = ctx?.kind === 'team' || ctx?.kind === 'club';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <StatusBar style="auto" />
      <View style={{ padding: space[2], backgroundColor: c.sandboxSubtle }}><Text style={{ color: c.sandbox, fontSize: 12 }}>Sandbox: synthetic data, nothing real is sent or charged.</Text></View>
      {s.signedIn && ctx && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space[3], borderBottomWidth: 1, borderColor: c.border }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Acting as ${ctx.label}. Change context`} onPress={() => setPicking(!picking)} style={{ minHeight: touch.minTarget, justifyContent: 'center' }}>
            <T kind="bodyStrong">{ctx.label} ▾</T>
          </Pressable>
          <Button title="Sign out" onPress={s.signOut} />
        </View>
      )}
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[3] }}>
        {!s.ready ? null : !s.signedIn ? <SignIn /> : picking ? (
          <View style={{ gap: space[2] }}>
            <T kind="title">Act as</T>
            {s.choices.map((x) => <Button key={contextKey(x)} title={`${x.kind}: ${x.label}`} variant={ctx && contextKey(ctx) === contextKey(x) ? 'primary' : 'default'} onPress={() => { s.choose(x); setPicking(false); if (x.kind !== 'team' && x.kind !== 'club') setTab('home'); }} />)}
          </View>
        ) : !ctx ? (
          s.contexts ? <T>Not connected to a club, team or family yet. Ask your coach for an invite.</T> : <Badge tone="pending" text="Loading" />
        ) : (
          <View key={contextKey(ctx)}>
            {tab === 'home' && <Home ctx={ctx} />}
            {tab === 'staff' && staffTab && <Staff />}
            {tab === 'messages' && <Messages />}
          </View>
        )}
      </ScrollView>
      {s.signedIn && ctx && !picking && (
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
          {(['home', ...(staffTab ? ['staff'] : []), 'messages'] as Tab[]).map((t) => (
            <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => setTab(t)}
              style={{ flex: 1, minHeight: touch.minTarget + 12, alignItems: 'center', justifyContent: 'center', borderTopWidth: 3, borderColor: tab === t ? c.accent : 'transparent' }}>
              <T kind="label" muted={tab !== t}>{t === 'home' ? 'Home' : t === 'staff' ? 'Staff Room' : 'Messages'}</T>
            </Pressable>
          ))}
        </View>
      )}
    </SafeAreaView>
  );
}
