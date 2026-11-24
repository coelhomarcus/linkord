import * as THREE from 'three';

// The playground's cel-shaded look, part two: ink outlines drawn as a screen
// pass, the way the Moebius-style and Codrops "sketchy" tutorials do it. The
// scene is rendered once for colour and depth and once more with every surface
// showing its normal; a final pass draws ink wherever depth or normal changes
// sharply between neighbouring pixels. Unlike the inverted-hull trick
// (OutlineEffect), this outlines skinned and instanced meshes alike and leaves no
// gaps at the hard corners of flat-shaded boxes and cones.

/** Objects on this layer are drawn but never outlined: name labels, the sky. */
export const NO_OUTLINE_LAYER = 1;

const INK = new THREE.Color(0x1b1d2b);

const fragmentShader = /* glsl */ `
  #include <packing>
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D tNormal;
  uniform vec2 texel;
  uniform float thickness;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform float fadeNear;
  uniform float fadeFar;
  uniform vec3 ink;
  varying vec2 vUv;

  // 1 / distance: unlike distance itself it changes linearly across a flat
  // surface on screen, so a flat floor seen at a grazing angle has no edges
  float inverseDepth(vec2 uv) {
    return -1.0 / perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
  }

  vec3 normalAt(vec2 uv) {
    return texture2D(tNormal, uv).xyz * 2.0 - 1.0;
  }

  void main() {
    vec2 dx = vec2(texel.x * thickness, 0.0);
    vec2 dy = vec2(0.0, texel.y * thickness);

    float w = inverseDepth(vUv);
    float curvature = abs(inverseDepth(vUv - dx) + inverseDepth(vUv + dx) - 2.0 * w)
                    + abs(inverseDepth(vUv - dy) + inverseDepth(vUv + dy) - 2.0 * w);
    float depthEdge = smoothstep(0.12, 0.25, curvature / w);

    vec3 n = normalAt(vUv);
    float bend = (1.0 - dot(n, normalAt(vUv - dx))) + (1.0 - dot(n, normalAt(vUv + dx)))
               + (1.0 - dot(n, normalAt(vUv - dy))) + (1.0 - dot(n, normalAt(vUv + dy)));
    float normalEdge = smoothstep(0.5, 0.9, bend);

    // far lines fade into the fog with everything else
    float edge = max(depthEdge, normalEdge) * (1.0 - smoothstep(fadeNear, fadeFar, 1.0 / w));

    vec3 base = texture2D(tColor, vUv).rgb;
    gl_FragColor = vec4(mix(base, ink, edge), 1.0);
    #include <colorspace_fragment>
  }
`;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export class OutlineRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly color: THREE.WebGLRenderTarget;
  private readonly normals: THREE.WebGLRenderTarget;
  private readonly normalMaterial = new THREE.MeshNormalMaterial();
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly clearColor = new THREE.Color();

  constructor(renderer: THREE.WebGLRenderer, fade: { near: number; far: number }) {
    this.renderer = renderer;
    this.color = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: new THREE.DepthTexture(1, 1),
    });
    this.normals = new THREE.WebGLRenderTarget(1, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.color.texture },
        tDepth: { value: this.color.depthTexture },
        tNormal: { value: this.normals.texture },
        texel: { value: new THREE.Vector2() },
        thickness: { value: 1 },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 200 },
        fadeNear: { value: fade.near },
        fadeFar: { value: fade.far },
        ink: { value: INK.clone().convertSRGBToLinear() },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    const w = Math.max(1, Math.floor(width * pixelRatio));
    const h = Math.max(1, Math.floor(height * pixelRatio));
    this.color.setSize(w, h);
    this.normals.setSize(w, h);
    this.material.uniforms.texel!.value.set(1 / w, 1 / h);
    // the same line weight on a high-density screen
    this.material.uniforms.thickness!.value = Math.max(1, Math.round(pixelRatio));
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const renderer = this.renderer;
    camera.layers.enable(NO_OUTLINE_LAYER);
    renderer.setRenderTarget(this.color);
    renderer.render(scene, camera);

    // the same view again with normals instead of colours; no sky, labels or shadows needed
    const background = scene.background;
    scene.background = null;
    scene.overrideMaterial = this.normalMaterial;
    camera.layers.disable(NO_OUTLINE_LAYER);
    renderer.shadowMap.autoUpdate = false;
    renderer.getClearColor(this.clearColor);
    const clearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.normals);
    renderer.render(scene, camera);
    renderer.setClearColor(this.clearColor, clearAlpha);
    renderer.shadowMap.autoUpdate = true;
    scene.overrideMaterial = null;
    scene.background = background;
    camera.layers.enable(NO_OUTLINE_LAYER);

    this.material.uniforms.cameraNear!.value = camera.near;
    this.material.uniforms.cameraFar!.value = camera.far;
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.color.depthTexture?.dispose();
    this.color.dispose();
    this.normals.dispose();
    this.normalMaterial.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
