# Pirate Nation shipped Unity client — extracted facts

Reconnaissance only. Source tree: `/workspace/proofofplay/piratenation-game`
(Unity **2022.3.51f1**, URP, product `Pirate Nation`, company `proofofplay`).

## Licence buckets

Every row below is tagged with one of:

| Tag | Meaning |
|---|---|
| **PoP** | Authored by Proof of Play, under `Assets/_PirateNation_/`, `Assets/Settings/`, `ProjectSettings/`. MIT — we may port it if we carry `Copyright (c) 2026 Proof of Play, Inc.` where we use a substantial portion. |
| **3P** | Third-party Asset Store package or its configuration. **Do not port.** Reference only. |
| **PLACEHOLDER** | `Assets/DemoPlaceholder/` — stand-in art shipped with the open-sourcing. Reference only, and mostly Git-LFS pointers with no binary present. |

`LICENSE` lists the packages stripped before open-sourcing: Sirenix Odin, DOTween Pro,
CodeStage ACTk, Privy, Sentry, Epic Toon FX, ProTips, **Stylized Water 2**, Voxel Importer,
**Highlight Plus**, EnhancedScroller. Those directories are gone; only PoP's references to
them remain.

Shipped scene list is `ProjectSettings/EditorBuildSettings.asset`: `LoginScene`,
**`MainScene`** (the island), `CardCombatScene`. Everything below about "the island"
means `Assets/Scenes/MainScene.unity`.

---

## 1. The island camera — orthographic, confirmed

**Yes. It is a true orthographic camera at a fixed 35°/45° isometric rotation.** No pitch or
yaw animation exists anywhere in `CameraController`; only `orthographicSize` and the focus
point move.

### Camera component (`OrthoCam`, tag `MainCamera`)

| Field | Value | Source | Bucket |
|---|---|---|---|
| `orthographic` | `1` (true) | `Assets/Scenes/MainScene.unity:8475` (camera `&596961991`, GameObject `OrthoCam`) | PoP |
| `orthographic size` | **39** (scene-authored start) | `Assets/Scenes/MainScene.unity:8476` | PoP |
| `orthographic size` | **32** (prefab default) | `Assets/_PirateNation_/Game/TheRoad/CamContainer.prefab:110` | PoP |
| `near clip plane` | **0.3** | `MainScene.unity:8472`, prefab | PoP |
| `far clip plane` | **500** | `MainScene.unity:8473`, prefab | PoP |
| `field of view` | 35 (ignored while orthographic) | `MainScene.unity:8474` | PoP |
| `m_ClearFlags` | `1` = Skybox | both | PoP |
| `m_BackGroundColor` | `0.19215687, 0.3019608, 0.4745098, a 0` = **#314D79** (only used if clear flags were SolidColor) | both | PoP |
| `m_Depth` | 1 | `MainScene.unity` | PoP |
| `m_HDR` | 1, `m_AllowMSAA` 0, `m_Antialiasing` 0 (none) | `MainScene.unity` | PoP |
| `m_RenderPostProcessing` | **1** (profile asset is missing — see §2) | `MainScene.unity:8547` | PoP |

### Rotation — the number we were faking

| Field | Value | Source |
|---|---|---|
| Rig `CamContainer` euler | **X 35, Y 45, Z 0** | `MainScene.unity` transform `&675687693` (`m_LocalRotation 0.27781588, 0.36497167, -0.1150751, 0.8811196`, hint `35,45,0`) and `CamContainer.prefab:27,35` |
| `OrthoCam` local rotation | identity — the camera inherits the rig rotation verbatim | `MainScene.unity` `&596961996`; `CamContainer.prefab:66` |
| Derived camera forward | `(0.5792, -0.5736, 0.5792)` — elevation **35.0°**, azimuth **45.0°** | computed from the quaternion (verified it reproduces exactly) |

The quaternion was verified against Unity's ZXY euler order and matches `(35, 45, 0)` to
7 decimal places, so the euler hint is not stale.

> Two authored copies of the same rig exist and they agree on rotation and clip planes but
> **not** on zoom range: `MainScene`'s `CamContainer` → `OrthoCam` is scene-authored
> (`m_PrefabInstance: 0`), while `Assets/_PirateNation_/Game/TheRoad/CamContainer.prefab`
> is a parallel copy used by the Saga/Road feature. When they disagree, **`MainScene` wins**
> — it is the shipped island.

### Zoom and pan (serialized `CameraController` defaults)

| Field | `MainScene` | `CamContainer.prefab` | Note |
|---|---|---|---|
| `zoomMin` | **7** | 7 | hard clamp, `Mathf.Clamp` on `orthographicSize` |
| `zoomMax` | **39** | 32 | |
| `scrollSpeed` | 25 | 25 | `size -= scrollDelta.y * 25 * dt` |
| `zoomSpeedPinch` | 0.05 | 0.05 | C# field initializer is `0.5f`; both authored copies say 0.05 |
| `panSpeed` | 35 | 35 | keyboard pan, units/s, vector run through `.ToIso()` |
| `clampDistance` | 600 | 600 | `shouldClamp: 1` |
| `poiCamY` | 9 | 9 | |
| `poiFollowTime` | 0.125 | 0.125 | `Vector3.Lerp` factor per FixedUpdate |
| `characterFocusOrthoSize` | 32 | 32 | zoom used when the avatar is selected |

Hard-coded zoom targets in `Assets/_PirateNation_/Game/WorldObjects/Runtime/CameraController.cs`:

| Event | orthographicSize | Tween | Line |
|---|---|---|---|
| `PanToPoi` default | **30** | `DOOrthoSize(size, 2s)`, move `Ease.OutCubic` | 411, 420, 428 |
| Starter island on load | **30** | snapped, no tween | 330–333 |
| Focus on POI (`OnFocusOnPoi`) | **17** | 0 s cam height | 91 |
| Gacha / wishing well | **14** | 1 s, locked, zoom locked | 96 |
| Avatar selected | **32** | 2 s | 356 |
| `poiOffset` | `(0, 8, 0)` set in `Start()` (overrides the serialized `(0,0,0)`) | | 110 |

### Scale anchor

`gridSize = 2.0` world units per island-builder tile
(`Assets/_PirateNation_/Game/IslandBuilder/Runtime/IslandGrid.cs:52`,
`IslandBuilder.cs:29`). Play area is a sphere of radius **160** around **(125, 3, 125)**
(`Assets/_PirateNation_/Game/Core/Runtime/Utils/FeatureManager.cs:30-31`, applied by
`CameraController.ClampToFeatureArea`).

Derived view footprints at 16:9 (`defaultScreenWidthWeb 1920 × 1080`,
`ProjectSettings/ProjectSettings.asset`):

| orthoSize | View W × H (units) | Ground depth (H / sin 35°) | Tiles across |
|---|---|---|---|
| 7 (min) | 24.9 × 14.0 | 24.4 | 12 |
| 14 (well) | 49.8 × 28.0 | 48.8 | 25 |
| 17 (POI) | 60.4 × 34.0 | 59.3 | 30 |
| 30 (default POI) | 106.7 × 60.0 | 104.6 | 53 |
| 32 (prefab / avatar) | 113.8 × 64.0 | 111.6 | 57 |
| 39 (scene start / max) | 138.7 × 78.0 | 136.0 | 69 |

Authored camera world position in `MainScene` is `(70.07, 55.47, 68.24)`; its centre ray
hits `y = 0` at `(126.1, 0, 124.3)` — i.e. exactly the play-area centre. At `Start()` the
camera is reparented to `worldFocusPoint`, so this offset becomes the fixed rig offset.

**What this changes for us:** replace the 10° fake-perspective lens with a real
`THREE.OrthographicCamera` rotated to elevation 35°, azimuth 45°, `near 0.3`, `far 500`, and
drive a single `zoom`/frustum-height parameter clamped to `[7, 39]` half-height with a start
of 39. One world unit ≈ half an island tile; a 39 half-height frame shows ~69 × 68 tiles.

---

## 2. Lighting and post

### The sun — one directional light for the whole island

`Assets/_PirateNation_/Prefabs/World/DirectionalLight.prefab`, instanced once inside
`Assets/_PirateNation_/Prefabs/World/Island.prefab` (line 32840) with overrides. There is
**exactly one** `!u!108` Light in the island and no light at all authored directly in
`MainScene`. Verified: `MainScene` applies no further overrides to it.

| Field | Value | Source | Bucket |
|---|---|---|---|
| Type | Directional (`m_Type: 1`) | `DirectionalLight.prefab:46` | PoP |
| **Euler rotation** | **X 34.696, Y 16.502, Z −4.762** | `DirectionalLight.prefab:36`; re-asserted by the `Island.prefab` override | PoP |
| **Colour** | **white `1,1,1`** (island override re-asserts `m_Color.r`/`m_Color.g` = 1; `b` stays 1 from the prefab) | `.prefab:48` + `Island.prefab` override | PoP |
| **Intensity** | **1.0** (not overridden) | `.prefab:49` | PoP |
| Shadows | Hard (`m_Shadows.m_Type: 1`) | `.prefab:55` | PoP |
| **Shadow strength** | **0.86** on the island (prefab default 0.7) | `Island.prefab` override | PoP |
| Shadow bias / normal bias / near | 1 / 0 / 0.1 | `.prefab:59-61` | PoP |
| Lightmapping | `4` = Realtime. Baked lightmaps **off**; zero meshes carry a lightmap index | `.prefab:88`, `Assets/Settings/Lighting Settings.lighting` `m_EnableBakedLightmaps: 0` | PoP |
| `DayNightCycleLight` | present but self-`Destroy()`s when no `DayNightCycleManager` exists — and `MainScene` has none | `DayNightCycle/Runtime/DayNightCycleLight.cs:39-46` | PoP |

Derived sun vector: direction of travel `(0.2335, −0.5692, 0.7883)`; elevation **34.7°**,
azimuth of travel **16.5°**. The camera looks along azimuth 45° at elevation 35°, so **the
sun is only 28.5° off the camera azimuth and at essentially the same elevation** — it is a
near-frontal / over-the-shoulder key light, and shadows fall up-and-left, largely hidden
behind their casters.

### Ambient / environment

| Field | Value | Source | Bucket |
|---|---|---|---|
| `m_AmbientMode` | **3 = Flat (single colour)** | `MainScene.unity:27` | PoP |
| `m_AmbientSkyColor` (the flat colour) | `0.3882353` grey = **#636363** | `MainScene.unity:23` | PoP |
| `m_AmbientIntensity` | 1 | `MainScene.unity:26` | PoP |
| `m_Fog` | **0 — fog is off** | `MainScene.unity:17` | PoP |
| Skybox material | Unity built-in `Default-Skybox` (procedural), never replaced | `MainScene.unity:29` `fileID 10304, guid 0000…f000…` | Unity built-in |
| Equator / ground ambient | Unity defaults, unused in Flat mode | `MainScene.unity:24-25` | — |

> `DayNightCycleAmbientUpdater` can drive ambient/fog/skybox at runtime, but only in
> combat/dungeon scenes that carry a `DayNightCycleManager`. `MainScene` does not.

### **Colour space: Gamma**

`ProjectSettings/ProjectSettings.asset:52` → `m_ActiveColorSpace: 0` = **Gamma**, not Linear.
All the light and ambient numbers above are applied directly to sRGB-encoded albedo with no
linearisation.

### URP pipeline

Two different assets are easy to confuse here — get this right:

- `ProjectSettings/GraphicsSettings.asset:51` points at `Assets/Settings/High_PipelineAsset.asset`.
  That is only the **fallback**, and no quality level ever selects it.
- Every quality level carries its own `customRenderPipeline`
  (`ProjectSettings/QualitySettings.asset`), and the level names do **not** match the asset
  names — levels 2 and 3 share one asset:

  | Index | Level name | Pipeline asset actually used |
  |---|---|---|
  | 0 | Very Low | `Very Low_PipelineAsset` |
  | 1 | Low | `Low_PipelineAsset` |
  | 2 | Medium | `Medium_PipelineAsset` |
  | **3** | **High** | **`Medium_PipelineAsset`** (same asset as level 2) |
  | 4 | Very High | `Very High_PipelineAsset` |
  | 5 | Ultra | `Ultra_PipelineAsset` |

- The shipped default is index **3**
  (`Assets/_PirateNation_/Game/UI/SettingsWindowController.cs:23` `DefaultQualityForWebGl = 3`,
  applied by `InitGameQuality()` → `QualitySettings.SetQualityLevel(3, true)`), so the
  **effective shipped pipeline is `Assets/Settings/Medium_PipelineAsset.asset`**.
  `m_CurrentQuality: 5` in `QualitySettings.asset` is only the editor's last-used level.

| Field | **Medium (= shipped default)** | High_PipelineAsset (fallback only) | Ultra | Bucket |
|---|---|---|---|---|
| `m_ShadowDistance` | **150** | 150 | 300 | PoP |
| `m_ShadowCascadeCount` | **1** | 2 | 3 | PoP |
| `m_Cascade2Split` / `m_CascadeBorder` | 0.33333334 / 0.2 (unused at 1 cascade) | 0.33333334 / 0.2 | — | PoP |
| `m_MainLightShadowmapResolution` | **1024** | 2048 | 2048 | PoP |
| `m_SoftShadowsSupported` | **0 — hard shadows only** | 1 | 0 | PoP |
| `m_SoftShadowQuality` | 2 (moot while soft shadows are off) | 2 | — | PoP |
| `m_ShadowDepthBias` / `m_ShadowNormalBias` | 1 / 1 | 1 / 1 | 1 / 1 | PoP |
| `m_MainLightRenderingMode` | 1 (per-pixel) | 1 | 1 | PoP |
| `m_AdditionalLightsRenderingMode` | 0 (per-vertex) | 0 | 0 | PoP |
| `m_SupportsHDR` | 1 | 1 | 1 | PoP |
| `m_MSAA` | **1 = disabled** | 1 | 1 | PoP |
| `m_RenderScale` | 1 | 1 | 1 | PoP |
| `m_RequireDepthTexture` / `m_RequireOpaqueTexture` | **0 / 1** | 1 / 1 | — | PoP |
| `m_ColorGradingMode` / LUT size | 0 = LDR / 32 | 0 / 32 | 0 / 32 | PoP |
| `m_SupportsDynamicBatching` | 0 | 0 | — | PoP |

Note `m_RequireDepthTexture: 0` at the shipped level — the depth texture the water needs is
requested per-camera instead (`MainScene.unity` `m_RequiresDepthTextureOption: 1`).

Renderer: `Assets/Settings/Standard Forward Renderer.asset`, forward (`m_RenderingMode: 0`),
one renderer feature — PoP's own **OutlineFeature**:

| Field | Value | Bucket |
|---|---|---|
| `outlineColor` | HDR `6.4222345, 1.5467162, 0` (orange, >1 for bloom) | PoP |
| `outlineColorFriendly` | HDR `0, 8.574187, 0.0336` | PoP |
| `outlineColorEnemy` | HDR `8.574187, 0, 0` | PoP |
| `threshold` | 0.16 (luma) | PoP |
| `renderPassEvent` | 500 (after transparents) | PoP |
| Kernel | 16 neighbour taps at ±1 and ±2 texels, luma test | PoP |

Source: `Assets/_PirateNation_/RendererFeatures/Outline/{OutlineFeature.cs,Outline.shader}`.

### Post-processing volume — **NOT FOUND**

The camera has `m_RenderPostProcessing: 1` and a `Volume` component pointing at
`sharedProfile guid 27dd6a104ca0c584097786eb06c01755` (`MainScene.unity:8547`, plus 15 other
scenes/prefabs). **No asset in the repository has that guid** — the VolumeProfile file was
not published. There is no VolumeProfile asset anywhere in `Assets/` (searched for
Tonemapping / ColorAdjustments / Bloom / Vignette across `.asset`, `.unity`, `.prefab`).

Therefore: **tonemapping mode, colour grading, bloom, and vignette values are not
findable.** Do not guess them. What *is* known: HDR is on, colour grading mode is LDR with
a 32³ LUT, camera antialiasing is None, and the outline feature emits HDR colours up to 8.6,
which only makes sense if a bloom override existed in that missing profile.

`Assets/Settings/SelectionAndHighlight.asset` is a **Highlight Plus (3P, removed)** profile —
reference only: `overlayColor 1, 0.5019608, 0` (#FF8000), `outlineColor` HDR `2, 1.0039, 0`,
`outlineWidth 0.2`.

**What this changes for us:** three concrete moves. (a) One white directional light,
intensity 1, at elevation 34.7° / azimuth 16.5°, shadow strength 0.86 — near-frontal, not
the raking side light we probably have. (b) Flat ambient `#636363` at full strength, no
hemisphere gradient, no fog. (c) Their whole frame is composed in **gamma space**, so if we
render linear + sRGB-encode, our midtones sit darker and more contrasty than theirs; that
alone can read as "flat vs. not flat". Shadow budget to match: **150 units, one cascade,
1024 map, hard shadows** — a single tight shadow frustum, not a cascaded soft setup.

---

## 3. Water — third party, plainly

**There is no water shader or ocean material authored by Proof of Play.** Findings:

| Fact | Source | Bucket |
|---|---|---|
| The island's water is a prefab instance named `StylizedWater2_Ocean`, source prefab `guid 915defc4859ebad4789c339184a60ebf` — **absent from the repo** | `Assets/_PirateNation_/Prefabs/World/Island.prefab:25915`, `:25983` | 3P (Stylized Water 2) |
| It is parented under a PoP transform `Water` at local `(118.855, −0.685, 113.552)`, scale `(100, 2.6, 100)` — a Unity 10×10 plane, so **1000 × 1000 world units of ocean** | `Island.prefab` `&1894156289030538083` | PoP (transform only) |
| `README.md` lists **Stylized Water 2** among the removed commercial packages | `README.md:45` | — |
| The only StylizedWater2 material still present is a combat-arena one | `Assets/_PirateNation_/Game/Combat/Assets/Arenas/Icy Waters/StylizedWater2_Ocean.mat` | 3P config — reference only |
| Every `.shader`/`.shadergraph` under `Assets/_PirateNation_` was enumerated: none is a water/ocean surface shader (only VFX splashes, skybox, voxel chunk, outline, UI shine) | — | — |
| `Assets/DemoPlaceholder/LowPolyWater_Pack` and `Assets/ToonWaterShader-skeleton_project` exist but are **not referenced** by the island or by `MainScene` | — | 3P |
| `CameraController` pins the water plane's Y every frame and parents it to the focus point, so the ocean follows the camera | `CameraController.cs:109, 113, 443-447` | PoP |

Reference-only numbers from `Icy Waters/StylizedWater2_Ocean.mat` (a **3P shader's**
parameter block — do not port). **Caveat: this is the *combat arena* ocean, not the
island's.** The island's own water material lives inside the missing prefab, so its exact
colours are **not found**. Treat the table below as an order-of-magnitude sanity target
only:

| Property | Value | Hex |
|---|---|---|
| `_BaseColor` (deep) | `0.00784, 0.06498, 0.25490` | `#021141` |
| `_ShallowColor` | `0.01569, 0.12549, 0.50980` | `#042082` |
| `_WaterColor` | `0.21176, 0.67451, 1.0` | `#36ACFF` |
| `_WaterShallowColor` | `0.0, 0.93945, 1.0` | `#00F0FF` |
| `_FoamColor` | `0.74902` grey | `#BFBFBF` |
| `_HorizonColor` | HDR `0.38042, 0.53729, 4.54121`, a 0.2784 | — |
| `_IntersectionColor` | white, a 0.16471 | — |
| Depth | `_Depth 2.42`, `_DepthHorizontal 0.3`, `_DepthVertical 0.01`, `_DepthExp 1` | — |
| Foam | `_FoamSize 0.314`, `_FoamTiling 0.17`, `_FoamSpeed 0.1`, `_FoamBaseAmount 0.27`, `_FoamClipping 0.89`, `_FoamDistortion 1.71`, `_FoamWaveAmount 0.22`, `_FoamWaveMask 0.638` | — |
| Shoreline / intersection | `_IntersectionLength 3.5`, `_IntersectionSize 0.944`, `_IntersectionTiling 0.15`, `_IntersectionSpeed 0.033`, `_IntersectionFalloff 0.9`, `_IntersectionClipping 0.86`, `_IntersectionRippleStrength 0.33`, `_ShoreLineLength 3.1`, `_ShoreLineWaveDistance 6`, `_ShoreLineWaveStr 0` | — |
| Waves | `_WaveCount 4`, `_WaveHeight 0.28`, `_WaveSpeed 1.6`, `_WaveDistance 0.34`, `_WaveNormalStr 0.05`, `_WaveTint 0.052`, `_WaveDirection 0.5, 0.3, 0.75, 0.25` | — |
| Sparkle | `_SparkleIntensity 0.18`, `_SparkleSize 0.96` | — |

Depth/foam mechanism, as configured: the camera requests a scene depth texture
(`m_RequiresDepthTextureOption: 1` on `OrthoCam`) →
depth-fade between `_ShallowColor` and `_BaseColor` over `_Depth 2.42`; a separate
intersection/shoreline band of ~3.5 units driven by a noise texture; Gerstner-style waves
(4 waves, height 0.28); planar reflection only on the Ultra pipeline
(`Assets/Settings/Planar Reflections Renderer.asset`, referenced solely by
`Ultra_PipelineAsset`, and it has **zero** renderer features anyway).

A PoP-authored `UnderWaterPlane` sits at `y = −10.5` under the island with 100× scale,
using the **placeholder** `Assets/DemoPlaceholder/Materials/Background Material.mat`
(`_BaseColor 0.5188679` grey = `#848484`).

**What this changes for us:** their water is bought, not built — we keep ours. The one thing
worth copying is the *architecture*: an ocean plane 1000 units square, parented to the
camera focus point so it never runs out, with a shoreline band ~3.5 units wide and a
depth fade over ~2.4 units.

---

## 4. Colour

### The only shared palette asset

`Assets/_PirateNation_/Game/UI/_v2/Editor/ColorPalette.asset`
(`PNColorPalette` ScriptableObject, `PNColorPalette.cs`), applied by `UIColorUpdater.cs`
which sets `Image.color = colors[colorIndex]`. **PoP.**

| Index | RGB (0–1) | 8-bit | Hex |
|---|---|---|---|
| 0 | 0.56078, 0.23137, 0.38824 | 143, 59, 99 | **#8F3B63** |
| 1 | 0.24706, 0.48627, 0.65490 | 63, 124, 167 | **#3F7CA7** |
| 2 | 0.85098, 0.21569, 0.26667 | 217, 55, 68 | **#D93744** |
| 3 | 0.22353, 0.67843, 0.21961 | 57, 173, 56 | **#39AD38** |
| 4 | 0.90588, 0.80000, 0.69412 | 231, 204, 177 | **#E7CCB1** |
| 5 | 0.83137, 0.67059, 0.60784 | 212, 171, 155 | **#D4AB9B** |
| 6 | 0.04706, 0.07059, 0.28627 | 12, 18, 73 | **#0C1249** |

That is the whole theme asset — there is no other colour constants file. UI buttons tint at
`1,1,1`; all their chrome colour lives in sprite art, not in code.

### Rarity gradients (`Assets/_PirateNation_/Game/Core/Runtime/Managers/Prefabs/TextureManager.prefab`, `rarityGradients`) — PoP

| Rarity | Gradient start → mid |
|---|---|
| 1 Common | `#FFFFFF` → `#A4A4A4` |
| 2 Uncommon | `#BEBEBE` → `#6C6C6C` |
| 3 Rare | `#89FD76` → `#73D862` |
| 4 Epic | `#9DE8FA` → `#1EA5FD` |
| 5 Legendary | `#FA9DF8` → `#F152FD` |
| 6 Mythic | `#FACB9D` → `#FDA352` |
| 7 | `#FFF78F` → `#FDE352` |
| 8 | `#54E4FA` → `#EF52FD` |

### Inline accents (rich text, PoP)

`#D5511D` (BOOTY / leaderboard highlight, `Assets/Resources/i18n/en/translation.json`),
`#38A169` (positive stat, `Game/UI/PirateCard.cs:375`),
`#FF8000` (at cap) and `#FF4000` (over cap) in
`Game/DeckManagement/UI/DeckSelectionUI.cs:238-239`.

### Fonts (PoP choice, font files 3P)

`Anek Latin` — Bold, ExtraBold, Medium SDF, plus `Forced Square` and `Courier Prime Code`
(`Assets/TextMesh Pro/Resources/Fonts & Materials/`). Style sheet
`PNTextStyleSheet.asset` has one meaningful entry: `ButtonMainText` =
`<font="AnekLatin-Bold SDF"><size=30>`.

### Sea / sand / grass

| Thing | Value | Source | Bucket |
|---|---|---|---|
| Camera background (unused, clear flags = Skybox) | **#314D79** | `MainScene.unity`, `CamContainer.prefab:85` | PoP |
| Ambient flat | **#636363** | `MainScene.unity:23` | PoP |
| Under-water backdrop plane | **#848484** | `DemoPlaceholder/Materials/Background Material.mat` | PLACEHOLDER |
| Placeholder water material — **unreferenced by any scene or prefab** | `0.13537, 0.64515, 0.73585` = **#23A5BC**, smoothness 0.708, metallic 0.092 | `DemoPlaceholder/Materials/Water.mat` | PLACEHOLDER |
| Grass — used only by `DemoPlaceholder/Prefabs/GrassCube.prefab` | base colour is white `1,1,1`; all colour is in `DemoPlaceholder/Textures/grass.png` | `DemoPlaceholder/Materials/Grass.mat` | PLACEHOLDER |
| Sand — used only by `DemoPlaceholder/Prefabs/SandRow.prefab`, `SandCube Variant.prefab` | base colour is white `1,1,1`; all colour is in `DemoPlaceholder/Textures/sand.png` | `DemoPlaceholder/Materials/Sand.mat` | PLACEHOLDER |

**`grass.png` and `sand.png` are Git-LFS pointer stubs (129 bytes each), not images** — the
binaries were not fetched with the clone, so their colours are **not findable** from this
tree. Same caveat applies to every other texture in the repo.

**What this changes for us:** the only citable PoP palette is those seven swatches plus the
rarity ramps. The terrain colours we are matching from `island_hero.png` do not exist as
numbers in this repo — keep sampling the screenshot.

---

## 5. Retention and economy

**There is no local balance data file. None.** The shipped economy is entirely on-chain /
server-side; the client holds only *shapes* and *key names*, then reads values over GraphQL.

| What we looked for | What is actually there |
|---|---|
| Building costs / timers | Component *schemas* only, `Assets/_PirateNation_/Mage/Runtime/Components/Generated/` (210 generated components) |
| Levels | `LevelComponent` (`value`), `ItemSlotsPerLevelComponent` (`BigInteger[] value`) |
| Building upgrades | `CraftingBuildingUpgradeRunnerConfigComponent` (`next_level_entity`, `current_level_entity`), `CraftingBuildingTransformConfigComponent` (`BigInteger[] value`) |
| Timers | `TimeComponent`, `TimeRangeComponent`, `TransformConfigTimeLockComponent`, `GeneratorCooldownTimestampComponent`, `CreatedTimestampComponent` |
| Data payloads | Only `Cards_Manifest_1133132116.json`, avatar trait JSON, combat FTUE fixtures, i18n. No balance table. |

### The gem economy — the one real formula

`Assets/_PirateNation_/Game/Backend/Runtime/ECS/GemUtilitySystemEntity.cs:42-66` and
`GemTimeFormulaEntity.cs`. **PoP.**

```
gems = (numerator / denominator) * (timeToFill - range.lower_bound) + offset
```

- Piecewise: a list of `GemTimeFormulaEntity`, each with a `RangeComponent`
  (`lower_bound`, `upper_bound`) over remaining seconds; the first whose range contains
  `timeToFill` wins, and if none does (time above the last range) the **last** entry is used
  — the client explicitly mirrors the contract's behaviour here.
- `GemFormulaComponent` fields: `numerator`, `denominator`, `reduction`, `offset` (all
  `ulong`). `reduction` is declared but unused by the client.
- `GemCostMultiplierComponent` carries `resource_multiplier` and `cooldown_multiplier`
  separately, so speed-ups and resource-buys are priced by different multipliers.
- Returns `0` when `timeToFill == 0` or no formula is loaded.

### Energy / lives (the session gate)

`EnergyComponent` stores `last_energy_amount`, `last_spend_timestamp`,
`last_energy_earnable`, `last_earn_timestamp` — i.e. **lazy regeneration computed from a
timestamp**, never a ticking counter. `EnergyModel.cs:41` sets
`regenPerSecond = 1f / secondsFor1Regen`, clamps to `maxEnergy`, and has a separate
`vipRegenPerSecond`. `EnergyPackComponent` = `energy_amount` + `loot_entity` (price).

Balance keys the client asks the chain for
(`Assets/_PirateNation_/Game/Core/Runtime/Constants.cs:67-82`) — this is the useful shape:

```
set_captain_timeout_secs      total_xp_to_level_up        gold_to_level_up
daily_energy_amount           daily_lives_amount          daily_energy_regen_secs
daily_energy_regen_amount     vip_daily_energy_regen_amount
max_energy_earnable           energy_earnable_regen_secs  daily_lives_regen_seconds
account_xp_thresholds         trade_license_threshold     loot_per_level_upgrade_array
boss_battle.max_move_count    boss_battle.time_limit
```

### Retention surfaces present in the client

`Game/Checklist/` (daily checklist: `ChecklistItem` + concrete items — place island item,
craft ship, start bounty, set equipment, win battle, win gauntlet),
`Game/Backend/Runtime/ECS/{QuestEntity,BountyEntity,BountyGroupEntity,LeaderboardEntity,
PvpLeagueEntity,SubscriptionStatusEntity,RogueLivesEntity}.cs`, `SagaLivesModel.cs`
(lives with the same lazy-regen shape as energy).

**What this changes for us:** nothing to copy, and that is the finding — `balance.json` has
no shipped counterpart to sanity-check against. The two structural ideas worth keeping are
(a) the piecewise-linear gem/time curve with an explicit `offset` per band rather than a
single global rate, and (b) resource cost and cooldown priced by *separate* multipliers.

---

## Not found (say so, do not guess)

| Wanted | Status |
|---|---|
| Post-process profile: tonemapping, colour grading, bloom, vignette | **Not found.** `guid 27dd6a104ca0c584097786eb06c01755` referenced by 16 scenes/prefabs; no matching asset in the repo. |
| Lighting data asset / lightmaps | Not found (`guid 49381e58…`) — and irrelevant: baked lightmaps are disabled. |
| Scene lighting settings asset | Not found (`guid 230f8673…`); `Assets/Settings/Lighting Settings.lighting` is present and shows baking off. |
| Terrain / grass / sand colours | Not findable — textures are Git-LFS pointer stubs. |
| Any PoP water shader | Does not exist. |
| Local economy/balance data | Does not exist; on-chain. |
