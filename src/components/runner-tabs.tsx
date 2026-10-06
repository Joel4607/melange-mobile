import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { palette } from './customer-ui';

// Use the same native dock as the buyer workspace. Detail screens sit above
// this tab group in the runner stack, while location sharing stays mounted.
export default function RunnerTabs() {
  return <NativeTabs backgroundColor={palette.background} tintColor={palette.green} indicatorColor={palette.pale} labelStyle={{ selected: { color: palette.green } }}>
    <NativeTabs.Trigger name="index">
      <NativeTabs.Trigger.Label>Dashboard</NativeTabs.Trigger.Label>
      <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="available">
      <NativeTabs.Trigger.Label>Find errands</NativeTabs.Trigger.Label>
      <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="history">
      <NativeTabs.Trigger.Label>My jobs</NativeTabs.Trigger.Label>
      <NativeTabs.Trigger.Icon sf="list.bullet" md="list" />
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="settings">
      <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
    </NativeTabs.Trigger>
  </NativeTabs>;
}
