import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { CustomerButton, CustomerPage, palette, ServiceLoading, ui, useServices } from '@/components/customer-ui';

export default function ServicesScreen() {
  const router = useRouter();
  const { category } = useLocalSearchParams<{ category?: string }>();
  const [selected, setSelected] = useState<string | undefined>(category);
  const { services, slow } = useServices();
  useEffect(() => setSelected(category), [category]);
  const ordered = services ? [...services].sort((a, b) => Number(b.id === category) - Number(a.id === category)) : undefined;
  return <CustomerPage>
    <Text style={ui.eyebrow}>A HELPING HAND, NEARBY</Text><Text style={ui.title}>Everyday errands.{'\n'}A little easier.</Text><Text style={ui.body}>Explore what Melange can help with. Tap a service for an example.</Text>
    {ordered === undefined ? <ServiceLoading slow={slow} /> : ordered.map((service) => <Pressable key={service.id} accessibilityRole="button" accessibilityLabel={service.name} accessibilityState={{ expanded: selected === service.id }} onPress={() => setSelected(selected === service.id ? undefined : service.id)} style={[ui.card, selected === service.id && { borderColor: palette.green }]}>
      <View style={ui.row}><View style={[ui.icon, { backgroundColor: service.color }]}><Text style={{ fontSize: 25 }}>{service.icon}</Text></View><View style={{ flex: 1 }}><Text style={ui.h3}>{service.name}</Text><Text style={ui.small}>{service.description}</Text></View><Text style={ui.h2}>{selected === service.id ? '−' : '+'}</Text></View>
      {selected === service.id && <View style={{ backgroundColor: palette.pale, padding: 15, borderRadius: 14, gap: 6 }}><Text style={ui.eyebrow}>AN ERRAND LIKE THIS</Text><Text style={[ui.body, { color: palette.ink }]}>{service.example}</Text></View>}
    </Pressable>)}
    <CustomerButton onPress={() => router.navigate({ pathname: '/post', params: selected ? { category: selected } : {} })}>{selected ? 'Post this type of errand →' : 'Post an errand →'}</CustomerButton>
  </CustomerPage>;
}
