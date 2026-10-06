import { Tabs, TabList, TabTrigger, TabSlot } from 'expo-router/ui';
import { Text } from 'react-native';
import { palette, ui } from './customer-ui';

export default function RunnerTabs() {
  return <Tabs style={{ flex: 1, backgroundColor: palette.background }}>
    <TabSlot style={{ flex: 1 }} />
    <TabList style={{ padding: 8, gap: 2, justifyContent: 'space-evenly', backgroundColor: palette.background, borderTopWidth: 1, borderTopColor: palette.line }}>
      <TabTrigger name="dashboard" href="/runner" style={{ padding: 10 }}><Text style={ui.h3}>Dashboard</Text></TabTrigger>
      <TabTrigger name="available" href="/runner/available" style={{ padding: 10 }}><Text style={ui.h3}>Find errands</Text></TabTrigger>
      <TabTrigger name="history" href="/runner/history" style={{ padding: 10 }}><Text style={ui.h3}>My jobs</Text></TabTrigger>
      <TabTrigger name="settings" href="/runner/settings" style={{ padding: 10 }}><Text style={ui.h3}>Settings</Text></TabTrigger>
    </TabList>
  </Tabs>;
}
