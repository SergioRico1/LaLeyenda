import * as THREE from 'three';

/** Renderer, camera rig and lighting shared by every scene. */

export interface StageOptions {
  canvas: HTMLCanvasElement;
  /** Fixed size for deterministic screenshots; otherwise tracks the window. */
  fixedSize?: { width: number; height: number } | null;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  private fixedSize: { width: number; height: number } | null;

  constructor(opts: StageOptions) {
    this.fixedSize = opts.fixedSize ?? null;

    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    // Mobile GPUs choke above 2x; the voxel art gains nothing from more.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#8fd8ec');

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 800);

    // Sun from the upper right, matching the reference's shadow direction.
    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.1);
    this.sun.position.set(48, 72, 28);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 260;
    const extent = 46;
    Object.assign(this.sun.shadow.camera, {
      left: -extent, right: extent, top: extent, bottom: -extent,
    });
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Warm-to-cool ambient: sky light above, bounced sand light from below.
    this.scene.add(new THREE.HemisphereLight(0xbfe9ff, 0xe8d5a8, 1.15));

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const width = this.fixedSize?.width ?? window.innerWidth;
    const height = this.fixedSize?.height ?? window.innerHeight;
    this.renderer.setSize(width, height, !this.fixedSize);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
