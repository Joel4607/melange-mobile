import { Tabs, TabList, TabTrigger, TabSlot } from 'expo-router/ui';
import { Text } from 'react-native';
import { palette, ui } from '@/components/customer-ui';

export default function AppTabs() {
  return <Tabs style={{ flex: 1, backgroundColor: palette.background }}>
    <TabSlot style={{ flex: 1 }} />
    <TabList style={{ padding: 8, gap: 2, justifyContent: 'space-evenly', backgroundColor: palette.background, borderTopWidth: 1, borderTopColor: palette.line }}>
      <TabTrigger name="home" href="/" style={{ padding: 12 }}><Text style={ui.h3}>Home</Text></TabTrigger>
      <TabTrigger name="services" href="/explore" style={{ padding: 12 }}><Text style={ui.h3}>Services</Text></TabTrigger>
      <TabTrigger name="post" href="/post" style={{ padding: 12 }}><Text style={ui.h3}>Post</Text></TabTrigger>
      <TabTrigger name="errands" href="/errands" style={{ padding: 12 }}><Text style={ui.h3}>Errands</Text></TabTrigger>
      <TabTrigger name="account" href="/account" style={{ padding: 10 }}><Text style={ui.h3}>Settings</Text></TabTrigger>
    </TabList>
  </Tabs>;
}
