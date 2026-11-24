import { GLView } from 'expo-gl';
import { useEffect, useImperativeHandle, useRef, forwardRef, type ComponentRef } from 'react';
import { PanResponder, Platform, View } from 'react-native';
import { WebGLRenderer } from 'three';

import { createMeshRig, type MeshRig, type MeshShot } from '@/src/lib/meshView';

export type MeshStageHandle = {
  shot(view: MeshShot): Uint8Array | null;
  setSpin(value: boolean): void;
  zoom(by: number): void;
};

type Props = {
  glb: Uint8Array;
  spin: boolean;
  onReady?: () => void;
};

export const MeshStage = forwardRef<MeshStageHandle, Props>(function MeshStage({ glb, spin, onReady }, ref) {
  const host = useRef<ComponentRef<typeof View>>(null);
  const rigRef = useRef<MeshRig | null>(null);
  const spinRef = useRef(spin);
  const yaw = useRef(0.4);
  const pitch = useRef(0.2);
  const distance = useRef(2.5);
  const readySent = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  spinRef.current = spin;

  useImperativeHandle(ref, () => ({
    shot(view) {
      return rigRef.current?.shot(view) ?? null;
    },
    setSpin(value) {
      spinRef.current = value;
    },
    zoom(by) {
      distance.current = Math.max(1.2, Math.min(5, distance.current + by));
    },
  }));

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (event, gesture) => {
        const touches = event.nativeEvent.touches?.length ?? 1;
        if (touches > 1) {
          distance.current = Math.max(1.2, Math.min(5, distance.current - gesture.dy * 0.01));
          return;
        }
        spinRef.current = false;
        yaw.current += gesture.dx * 0.01;
        pitch.current = Math.max(-1, Math.min(1, pitch.current + gesture.dy * 0.008));
      },
    }),
  ).current;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const current = host.current as unknown as { appendChild?: unknown; nodeType?: number; _nativeNode?: HTMLElement };
    const parent =
      current && current.nodeType === 1
        ? (current as unknown as HTMLElement)
        : current?._nativeNode && current._nativeNode.nodeType === 1
          ? current._nativeNode
          : null;
    if (!parent) return;
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.pointerEvents = 'none';
    parent.appendChild(canvas);
    const width = Math.max(320, parent.clientWidth || 360);
    const height = Math.max(360, parent.clientHeight || 420);
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const rig = createMeshRig(renderer, glb);
    rig.resize(width, height);
    rigRef.current = rig;
    let frame = 0;
    const loop = () => {
      if (spinRef.current) yaw.current += 0.012;
      rig.look(yaw.current, pitch.current, distance.current);
      rig.draw();
      if (!readySent.current) {
        readySent.current = true;
        onReadyRef.current?.();
      }
      frame = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(frame);
      rig.dispose();
      rigRef.current = null;
      canvas.remove();
    };
  }, [glb]);

  if (Platform.OS === 'web') {
    return <View ref={host} style={{ flex: 1 }} {...pan.panHandlers} />;
  }

  return (
    <View style={{ flex: 1 }} {...pan.panHandlers}>
      <GLView
        style={{ flex: 1 }}
        onContextCreate={(gl) => {
          const renderer = new WebGLRenderer({
            canvas: {
              width: gl.drawingBufferWidth,
              height: gl.drawingBufferHeight,
              clientWidth: gl.drawingBufferWidth,
              clientHeight: gl.drawingBufferHeight,
              style: {},
              addEventListener() {},
              removeEventListener() {},
            } as unknown as HTMLCanvasElement,
            context: gl as unknown as WebGLRenderingContext,
            antialias: true,
            alpha: false,
            preserveDrawingBuffer: true,
          });
          renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight, false);
          const rig = createMeshRig(renderer, glb);
          rig.resize(gl.drawingBufferWidth, gl.drawingBufferHeight);
          rigRef.current = rig;
          let frame = 0;
          const loop = () => {
            if (spinRef.current) yaw.current += 0.012;
            rig.look(yaw.current, pitch.current, distance.current);
            rig.draw();
            gl.endFrameEXP();
            if (!readySent.current) {
              readySent.current = true;
              onReadyRef.current?.();
            }
            frame = requestAnimationFrame(loop);
          };
          loop();
          return () => {
            cancelAnimationFrame(frame);
            rig.dispose();
          };
        }}
      />
    </View>
  );
});
