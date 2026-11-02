import { useColorScheme, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function Home() {
  const dark = useColorScheme() !== 'light';

  return (
    <SafeAreaView style={[styles.screen, dark ? styles.dark : styles.light]}>
      <View style={styles.content}>
        <Text style={[styles.title, dark ? styles.lightText : styles.darkText]}>Your home</Text>
        <Text style={[styles.message, dark ? styles.secondaryDark : styles.secondaryLight]}>
          Connect Home Assistant to see your devices here.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  dark: { backgroundColor: '#000' },
  light: { backgroundColor: '#f5f5f7' },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  title: { fontSize: 34, fontWeight: '600', letterSpacing: -0.8 },
  message: { marginTop: 10, fontSize: 17, lineHeight: 24 },
  lightText: { color: '#f5f5f7' },
  darkText: { color: '#1d1d1f' },
  secondaryDark: { color: '#a1a1a6' },
  secondaryLight: { color: '#6e6e73' },
});
