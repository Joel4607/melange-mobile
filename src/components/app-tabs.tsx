import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { palette } from '@/components/customer-ui';

export default function AppTabs() {
  return <NativeTabs backgroundColor={palette.background} tintColor={palette.green} indicatorColor={palette.pale} labelStyle={{ selected: { color: palette.green } }}>
    <NativeTabs.Trigger name="index"><NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label><NativeTabs.Trigger.Icon src={require('@/assets/images/tabIcons/home.png')} renderingMode="template" /></NativeTabs.Trigger>
    <NativeTabs.Trigger name="explore"><NativeTabs.Trigger.Label>Services</NativeTabs.Trigger.Label><NativeTabs.Trigger.Icon src={require('@/assets/images/tabIcons/explore.png')} renderingMode="template" /></NativeTabs.Trigger>
    <NativeTabs.Trigger name="post"><NativeTabs.Trigger.Label>Post</NativeTabs.Trigger.Label><NativeTabs.Trigger.Icon sf="plus.circle" md="add_circle" /></NativeTabs.Trigger>
    <NativeTabs.Trigger name="errands"><NativeTabs.Trigger.Label>Errands</NativeTabs.Trigger.Label><NativeTabs.Trigger.Icon sf="list.bullet" md="list" /></NativeTabs.Trigger>
    <NativeTabs.Trigger name="account"><NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label><NativeTabs.Trigger.Icon sf="gearshape" md="settings" /></NativeTabs.Trigger>
  </NativeTabs>;
}
