import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path } from 'react-native-svg';
import Purchases, { PurchasesPackage } from 'react-native-purchases';

const RC_IOS_API_KEY = 'appl_CGOffGqHTxRwCBTxfCOjYXYfoOL';
const ENTITLEMENT_ID = 'remove_ads';
const PRODUCT_ID = 'com.thomasaldrin.aquadose.remove_ads';
const STORAGE_ADS_REMOVED_KEY = '@aquadose_ads_removed_v1';

type VolumeUnit = 'L' | 'gal';
type PresetKey = 'low' | 'medium' | 'high' | null;

const PRESETS: Record<'low' | 'medium' | 'high', { no3: string; po4: string; k: string }> = {
  low: { no3: '10', po4: '1', k: '10' },
  medium: { no3: '15', po4: '2', k: '15' },
  high: { no3: '20', po4: '3', k: '20' },
};

// Molar weights (g/mol)
const MW_KNO3 = 101.1032;
const MW_NO3 = 62.0049;
const MW_KH2PO4 = 136.0855;
const MW_PO4 = 94.9714;
const MW_K2SO4 = 174.2592;
const MW_K = 39.0983;

const FRAC_NO3_IN_KNO3 = MW_NO3 / MW_KNO3; // 0.613283
const FRAC_PO4_IN_KH2PO4 = MW_PO4 / MW_KH2PO4; // 0.697880
const FRAC_K_IN_K2SO4 = (2 * MW_K) / MW_K2SO4; // 0.448737

function WaterDropsIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"
        stroke="#10B981"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function FlaskIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M10 2v7.31L4.72 18.55A2 2 0 0 0 6.46 21.5h11.08a2 2 0 0 0 1.74-2.95L14 9.31V2M8.5 2h7M7 15h10"
        stroke="#10B981"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function AquaDoseMain() {
  const [volumeStr, setVolumeStr] = useState<string>('100');
  const [unit, setUnit] = useState<VolumeUnit>('L');
  const [activePreset, setActivePreset] = useState<PresetKey>('medium');
  const [no3Str, setNo3Str] = useState<string>('15');
  const [po4Str, setPo4Str] = useState<string>('2');
  const [kStr, setKStr] = useState<string>('15');

  const [adsRemoved, setAdsRemoved] = useState<boolean>(false);
  const [rcReady, setRcReady] = useState<boolean>(false);
  const [removeAdsPkg, setRemoveAdsPkg] = useState<PurchasesPackage | null>(null);
  const [priceLabel, setPriceLabel] = useState<string>('$9.99');
  const [paywallVisible, setPaywallVisible] = useState<boolean>(false);
  const [purchasing, setPurchasing] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;

    async function initPurchases() {
      try {
        const cached = await AsyncStorage.getItem(STORAGE_ADS_REMOVED_KEY);
        if (cached === 'true' && mounted) {
          setAdsRemoved(true);
        }
      } catch {}

      if (Platform.OS !== 'ios') {
        return;
      }

      try {
        Purchases.configure({ apiKey: RC_IOS_API_KEY });
        setRcReady(true);

        const customerInfo = await Purchases.getCustomerInfo();
        const isUnlocked = Boolean(customerInfo.entitlements.active[ENTITLEMENT_ID]);
        if (mounted) {
          setAdsRemoved(isUnlocked);
        }
        await AsyncStorage.setItem(STORAGE_ADS_REMOVED_KEY, isUnlocked ? 'true' : 'false');

        const offerings = await Purchases.getOfferings();
        const targetOffering = offerings.all['aquadose'] || offerings.current;
        const pkg =
          targetOffering?.lifetime ||
          targetOffering?.availablePackages.find(
            (p) => p.product.identifier === PRODUCT_ID || p.identifier === '$rc_lifetime'
          ) ||
          null;

        if (mounted && pkg) {
          setRemoveAdsPkg(pkg);
          if (pkg.product.priceString) {
            setPriceLabel(pkg.product.priceString);
          }
        }
      } catch (err) {
        // StoreKit / RevenueCat offline fallback
      }
    }

    initPurchases();
    return () => {
      mounted = false;
    };
  }, []);

  const handleSelectPreset = (preset: 'low' | 'medium' | 'high') => {
    setActivePreset(preset);
    setNo3Str(PRESETS[preset].no3);
    setPo4Str(PRESETS[preset].po4);
    setKStr(PRESETS[preset].k);
  };

  const calculation = useMemo(() => {
    const rawVol = parseFloat(volumeStr.replace(',', '.'));
    const volumeLiters =
      !isFinite(rawVol) || rawVol <= 0 ? 0 : unit === 'L' ? rawVol : rawVol * 3.785411784;

    const targetNo3 = Math.max(0, parseFloat(no3Str.replace(',', '.')) || 0);
    const targetPo4 = Math.max(0, parseFloat(po4Str.replace(',', '.')) || 0);
    const targetK = Math.max(0, parseFloat(kStr.replace(',', '.')) || 0);

    // Grams of KNO3 needed for targetNo3 (1 ppm = 1 mg/L = 0.001 g/L)
    const kno3Grams = (targetNo3 * volumeLiters * 0.001) / FRAC_NO3_IN_KNO3;
    const kFromKno3Ppm = targetNo3 * (MW_K / MW_NO3);

    // Grams of KH2PO4 needed for targetPo4
    const kh2po4Grams = (targetPo4 * volumeLiters * 0.001) / FRAC_PO4_IN_KH2PO4;
    const kFromKh2po4Ppm = targetPo4 * (MW_K / MW_PO4);

    // Remaining K needed from K2SO4
    const remainingKPpm = Math.max(0, targetK - kFromKno3Ppm - kFromKh2po4Ppm);
    const k2so4Grams = (remainingKPpm * volumeLiters * 0.001) / FRAC_K_IN_K2SO4;

    return {
      kno3Grams,
      kFromKno3Ppm,
      kh2po4Grams,
      kFromKh2po4Ppm,
      k2so4Grams,
      remainingKPpm,
      targetNo3,
      targetPo4,
    };
  }, [volumeStr, unit, no3Str, po4Str, kStr]);

  const handlePurchaseRemoveAds = async () => {
    if (purchasing) return;
    setPurchasing(true);
    try {
      if (removeAdsPkg) {
        const { customerInfo } = await Purchases.purchasePackage(removeAdsPkg);
        if (customerInfo.entitlements.active[ENTITLEMENT_ID]) {
          setAdsRemoved(true);
          await AsyncStorage.setItem(STORAGE_ADS_REMOVED_KEY, 'true');
          setPaywallVisible(false);
          Alert.alert('Thank You!', 'Ads have been permanently removed from AquaDose.');
        }
      } else if (rcReady) {
        const products = await Purchases.getProducts([PRODUCT_ID]);
        if (products.length > 0) {
          const { customerInfo } = await Purchases.purchaseStoreProduct(products[0]);
          if (
            customerInfo.entitlements.active[ENTITLEMENT_ID] ||
            customerInfo.nonSubscriptionTransactions.some((t) => t.productIdentifier === PRODUCT_ID)
          ) {
            setAdsRemoved(true);
            await AsyncStorage.setItem(STORAGE_ADS_REMOVED_KEY, 'true');
            setPaywallVisible(false);
            Alert.alert('Thank You!', 'Ads have been permanently removed from AquaDose.');
          }
        } else {
          Alert.alert(
            'Product Unavailable',
            'Unable to load the Remove Ads product from the App Store right now. Please try again shortly.'
          );
        }
      }
    } catch (e: any) {
      if (!e?.userCancelled) {
        Alert.alert('Purchase Could Not Complete', e?.message || 'Please try again.');
      }
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestorePurchases = async () => {
    if (purchasing) return;
    setPurchasing(true);
    try {
      const customerInfo = await Purchases.restorePurchases();
      const unlocked =
        Boolean(customerInfo.entitlements.active[ENTITLEMENT_ID]) ||
        customerInfo.nonSubscriptionTransactions.some((t) => t.productIdentifier === PRODUCT_ID);
      if (unlocked) {
        setAdsRemoved(true);
        await AsyncStorage.setItem(STORAGE_ADS_REMOVED_KEY, 'true');
        setPaywallVisible(false);
        Alert.alert('Purchases Restored', 'Your Remove Ads upgrade has been restored.');
      } else {
        Alert.alert('No Purchases Found', 'No previous Remove Ads purchase was found for this Apple ID.');
      }
    } catch (e: any) {
      Alert.alert('Restore Failed', e?.message || 'Unable to restore purchases right now.');
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.container}>
            {/* Header */}
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.brandTitle}>
                  Aqua<Text style={styles.brandAccent}>Dose</Text>
                </Text>
                <Text style={styles.brandSubtitle}>Aquarium EI Calculator</Text>
              </View>
              {!adsRemoved ? (
                <Pressable
                  style={styles.removeAdsPill}
                  onPress={() => setPaywallVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Remove Ads"
                >
                  <Text style={styles.removeAdsPillText}>Remove Ads</Text>
                </Pressable>
              ) : (
                <View style={styles.proBadge}>
                  <Text style={styles.proBadgeText}>Ad-Free ✓</Text>
                </View>
              )}
            </View>

            {/* Tank Volume Card */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <WaterDropsIcon />
                <Text style={styles.cardTitle}>Tank Volume</Text>
              </View>
              <View style={styles.volumeRow}>
                <TextInput
                  style={styles.volumeInput}
                  value={volumeStr}
                  onChangeText={setVolumeStr}
                  keyboardType="decimal-pad"
                  placeholder="100"
                  placeholderTextColor="#475569"
                />
                <Pressable
                  style={[styles.unitButton, unit === 'L' && styles.unitButtonActive]}
                  onPress={() => setUnit('L')}
                >
                  <Text style={[styles.unitButtonText, unit === 'L' && styles.unitButtonTextActive]}>
                    L
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.unitButton, unit === 'gal' && styles.unitButtonActive]}
                  onPress={() => setUnit('gal')}
                >
                  <Text
                    style={[styles.unitButtonText, unit === 'gal' && styles.unitButtonTextActive]}
                  >
                    gal
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Target Dose Card */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <FlaskIcon />
                <Text style={styles.cardTitle}>Target Dose (ppm)</Text>
              </View>

              <View style={styles.presetRow}>
                {(['low', 'medium', 'high'] as const).map((presetKey) => {
                  const isSelected = activePreset === presetKey;
                  const label =
                    presetKey === 'low' ? 'Low' : presetKey === 'medium' ? 'Medium' : 'High';
                  return (
                    <Pressable
                      key={presetKey}
                      style={[styles.presetBtn, isSelected && styles.presetBtnActive]}
                      onPress={() => handleSelectPreset(presetKey)}
                    >
                      <Text
                        style={[styles.presetBtnText, isSelected && styles.presetBtnTextActive]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.ppmInputsRow}>
                <View style={styles.ppmCol}>
                  <Text style={styles.ppmLabel}>Nitrate (NO₃)</Text>
                  <TextInput
                    style={styles.ppmInput}
                    value={no3Str}
                    onChangeText={(v) => {
                      setActivePreset(null);
                      setNo3Str(v);
                    }}
                    keyboardType="decimal-pad"
                    placeholder="15"
                    placeholderTextColor="#475569"
                  />
                </View>

                <View style={styles.ppmCol}>
                  <Text style={styles.ppmLabel}>Phosphate (PO₄)</Text>
                  <TextInput
                    style={styles.ppmInput}
                    value={po4Str}
                    onChangeText={(v) => {
                      setActivePreset(null);
                      setPo4Str(v);
                    }}
                    keyboardType="decimal-pad"
                    placeholder="2"
                    placeholderTextColor="#475569"
                  />
                </View>

                <View style={styles.ppmCol}>
                  <Text style={styles.ppmLabel}>Potassium (K)</Text>
                  <TextInput
                    style={styles.ppmInput}
                    value={kStr}
                    onChangeText={(v) => {
                      setActivePreset(null);
                      setKStr(v);
                    }}
                    keyboardType="decimal-pad"
                    placeholder="15"
                    placeholderTextColor="#475569"
                  />
                </View>
              </View>
            </View>

            {/* Dosing Per Application Card */}
            <View style={styles.resultsCard}>
              <Text style={styles.resultsTitle}>Dosing Per Application</Text>

              <View style={styles.resultItem}>
                <View style={styles.resultTextCol}>
                  <Text style={styles.compoundName}>Potassium Nitrate</Text>
                  <Text style={styles.compoundSub}>
                    KNO₃ · {calculation.targetNo3.toFixed(1)} ppm NO3,{' '}
                    {calculation.kFromKno3Ppm.toFixed(1)} ppm K
                  </Text>
                </View>
                <Text style={styles.gramValue}>{calculation.kno3Grams.toFixed(2)} g</Text>
              </View>

              <View style={styles.divider} />

              <View style={styles.resultItem}>
                <View style={styles.resultTextCol}>
                  <Text style={styles.compoundName}>Monopotassium Phosphate</Text>
                  <Text style={styles.compoundSub}>
                    KH₂PO₄ · {calculation.targetPo4.toFixed(1)} ppm PO4,{' '}
                    {calculation.kFromKh2po4Ppm.toFixed(1)} ppm K
                  </Text>
                </View>
                <Text style={styles.gramValue}>{calculation.kh2po4Grams.toFixed(2)} g</Text>
              </View>

              <View style={styles.divider} />

              <View style={styles.resultItem}>
                <View style={styles.resultTextCol}>
                  <Text style={styles.compoundName}>Potassium Sulfate</Text>
                  <Text style={styles.compoundSub}>
                    K₂SO₄ · {calculation.remainingKPpm.toFixed(1)} ppm K
                  </Text>
                </View>
                <Text style={styles.gramValue}>{calculation.k2so4Grams.toFixed(2)} g</Text>
              </View>
            </View>

            {/* Sponsor / Remove Ads Card */}
            {!adsRemoved && (
              <Pressable
                style={styles.upgradeBanner}
                onPress={() => setPaywallVisible(true)}
                accessibilityRole="button"
              >
                <View style={styles.upgradeBannerLeft}>
                  <Text style={styles.upgradeBannerTitle}>Enjoying AquaDose?</Text>
                  <Text style={styles.upgradeBannerSub}>
                    Remove ads permanently with a one-time upgrade ({priceLabel})
                  </Text>
                </View>
                <View style={styles.upgradeBannerBtn}>
                  <Text style={styles.upgradeBannerBtnText}>{priceLabel}</Text>
                </View>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Remove Ads Modal */}
      <Modal
        visible={paywallVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPaywallVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalBadge}>ONE-TIME UPGRADE</Text>
            <Text style={styles.modalTitle}>Remove Ads Forever</Text>
            <Text style={styles.modalDescription}>
              Support independent development of AquaDose and unlock a clean, distraction-free
              dosing calculator experience forever with a single purchase.
            </Text>

            <View style={styles.modalPriceBox}>
              <Text style={styles.modalPriceLabel}>Remove Ads (Lifetime)</Text>
              <Text style={styles.modalPriceValue}>{priceLabel}</Text>
              <Text style={styles.modalPriceNote}>One-time payment · Family Shareable</Text>
            </View>

            <Pressable
              style={[styles.purchaseButton, purchasing && styles.buttonDisabled]}
              onPress={handlePurchaseRemoveAds}
              disabled={purchasing}
            >
              {purchasing ? (
                <ActivityIndicator color="#04130D" />
              ) : (
                <Text style={styles.purchaseButtonText}>
                  Unlock Ad-Free — {priceLabel}
                </Text>
              )}
            </Pressable>

            <Pressable
              style={styles.restoreButton}
              onPress={handleRestorePurchases}
              disabled={purchasing}
            >
              <Text style={styles.restoreButtonText}>Restore Purchases</Text>
            </Pressable>

            <View style={styles.legalLinksRow}>
              <Pressable
                onPress={() => Linking.openURL('https://fooaldrin.github.io/AquaDose/privacy/')}
              >
                <Text style={styles.legalLinkText}>Privacy Policy</Text>
              </Pressable>
              <Text style={styles.legalDot}>·</Text>
              <Pressable
                onPress={() => Linking.openURL('https://fooaldrin.github.io/AquaDose/support/')}
              >
                <Text style={styles.legalLinkText}>Support</Text>
              </Pressable>
            </View>

            <Pressable
              style={styles.closeModalBtn}
              onPress={() => setPaywallVisible(false)}
              disabled={purchasing}
            >
              <Text style={styles.closeModalBtnText}>Not Now</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AquaDoseMain />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#040711',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 32,
    alignItems: 'center',
  },
  container: {
    width: '100%',
    maxWidth: 480,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  brandTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: -0.5,
  },
  brandAccent: {
    color: '#10B981',
  },
  brandSubtitle: {
    fontSize: 15,
    color: '#94A3B8',
    marginTop: 2,
  },
  removeAdsPill: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  removeAdsPillText: {
    color: '#10B981',
    fontSize: 13,
    fontWeight: '700',
  },
  proBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  proBadgeText: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#0C1222',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 20,
    marginBottom: 16,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#10B981',
  },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  volumeInput: {
    flex: 1,
    height: 56,
    backgroundColor: '#050814',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingHorizontal: 16,
    fontSize: 22,
    fontWeight: '600',
    color: '#F8FAFC',
  },
  unitButton: {
    width: 60,
    height: 56,
    borderRadius: 14,
    backgroundColor: '#162032',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitButtonActive: {
    backgroundColor: '#10B981',
  },
  unitButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#94A3B8',
  },
  unitButtonTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  presetRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  presetBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#162032',
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetBtnActive: {
    backgroundColor: '#1E2D45',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  presetBtnText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#CBD5E1',
  },
  presetBtnTextActive: {
    color: '#10B981',
    fontWeight: '700',
  },
  ppmInputsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  ppmCol: {
    flex: 1,
  },
  ppmLabel: {
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 8,
  },
  ppmInput: {
    height: 50,
    backgroundColor: '#050814',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingHorizontal: 12,
    fontSize: 19,
    fontWeight: '600',
    color: '#F8FAFC',
  },
  resultsCard: {
    backgroundColor: '#031814',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#0E4836',
    padding: 20,
    marginBottom: 16,
  },
  resultsTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#10B981',
    marginBottom: 18,
  },
  resultItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  resultTextCol: {
    flex: 1,
    paddingRight: 12,
  },
  compoundName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F8FAFC',
    marginBottom: 4,
  },
  compoundSub: {
    fontSize: 14,
    color: '#94A3B8',
  },
  gramValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#10B981',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    marginVertical: 12,
  },
  upgradeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0C1222',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  upgradeBannerLeft: {
    flex: 1,
    paddingRight: 12,
  },
  upgradeBannerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  upgradeBannerSub: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 2,
  },
  upgradeBannerBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  upgradeBannerBtnText: {
    color: '#04130D',
    fontWeight: '800',
    fontSize: 14,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.82)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#0C1222',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 24,
    alignItems: 'center',
  },
  modalBadge: {
    fontSize: 11,
    fontWeight: '800',
    color: '#10B981',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F8FAFC',
    marginBottom: 10,
  },
  modalDescription: {
    fontSize: 15,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  modalPriceBox: {
    width: '100%',
    backgroundColor: '#031814',
    borderWidth: 1.5,
    borderColor: '#10B981',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  modalPriceLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#CBD5E1',
  },
  modalPriceValue: {
    fontSize: 32,
    fontWeight: '800',
    color: '#10B981',
    marginVertical: 4,
  },
  modalPriceNote: {
    fontSize: 13,
    color: '#94A3B8',
  },
  purchaseButton: {
    width: '100%',
    height: 54,
    backgroundColor: '#10B981',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  purchaseButtonText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#04130D',
  },
  restoreButton: {
    paddingVertical: 10,
    marginBottom: 8,
  },
  restoreButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#CBD5E1',
  },
  legalLinksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  legalLinkText: {
    fontSize: 12,
    color: '#64748B',
    textDecorationLine: 'underline',
  },
  legalDot: {
    fontSize: 12,
    color: '#64748B',
  },
  closeModalBtn: {
    paddingVertical: 8,
  },
  closeModalBtnText: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '600',
  },
});
