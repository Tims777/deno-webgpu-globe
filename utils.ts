import { getRowPadding } from "std/webgpu/row_padding.ts";
import { createCapture } from "std/webgpu/create_capture.ts";
import * as gmath from "gmath";
import * as png from "png";

export interface Dimensions {
  width: number;
  height: number;
}

export function copyToBuffer(
  encoder: GPUCommandEncoder,
  texture: GPUTexture,
  outputBuffer: GPUBuffer,
  dimensions: Dimensions,
): void {
  const { padded } = getRowPadding(dimensions.width);

  encoder.copyTextureToBuffer(
    {
      texture,
    },
    {
      buffer: outputBuffer,
      bytesPerRow: padded,
    },
    dimensions,
  );
}

export async function createPng(
  buffer: GPUBuffer,
  dimensions: Dimensions,
  filename: string,
): Promise<void> {
  await buffer.mapAsync(1);
  const inputBuffer = new Uint8Array(buffer.getMappedRange());
  const { padded, unpadded } = getRowPadding(dimensions.width);
  const outputBuffer = new Uint8Array(unpadded * dimensions.height);

  for (let i = 0; i < dimensions.height; i++) {
    const slice = inputBuffer
      .slice(i * padded, (i + 1) * padded)
      .slice(0, unpadded);

    outputBuffer.set(slice, i * unpadded);
  }

  const image = png.encode(
    outputBuffer,
    dimensions.width,
    dimensions.height,
    {
      stripAlpha: true,
      color: 2,
    },
  );
  Deno.writeFileSync(filename, image);

  buffer.unmap();
}

interface BufferInit {
  label?: string;
  usage: number;
  contents: ArrayBuffer;
}

export function createBufferInit(
  device: GPUDevice,
  descriptor: BufferInit,
): GPUBuffer {
  const contents = new Uint8Array(descriptor.contents);

  const alignMask = 4 - 1;
  const paddedSize = Math.max(
    (contents.byteLength + alignMask) & ~alignMask,
    4,
  );

  const buffer = device.createBuffer({
    label: descriptor.label,
    usage: descriptor.usage,
    mappedAtCreation: true,
    size: paddedSize,
  });
  const data = new Uint8Array(buffer.getMappedRange());
  data.set(contents);
  buffer.unmap();
  return buffer;
}

// deno-fmt-ignore
export const OPENGL_TO_WGPU_MATRIX = gmath.Matrix4.from(
  1.0, 0.0, 0.0, 0.0,
  0.0, 1.0, 0.0, 0.0,
  0.0, 0.0, 0.5, 0.0,
  0.0, 0.0, 0.5, 1.0,
);

export abstract class Renderable {
  constructor(public device: GPUDevice) {}
  abstract init(): void;
  abstract render(encoder: GPUCommandEncoder, view: GPUTextureView): void;
}

export async function requestDevice() {
  if (navigator.gpu) {
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter) {
      const device = await adapter.requestDevice();
      device.pushErrorScope("validation");
      return device;
    }
  }
  throw new Error("Could not find adapter");
}

export async function renderToPNG(object: Renderable, filename: string, dimensions: Dimensions) {
  const { texture, outputBuffer } = createCapture(
    object.device,
    dimensions.width,
    dimensions.height,
  );
  const encoder = object.device.createCommandEncoder();
  object.render(encoder, texture.createView());
  copyToBuffer(encoder, texture, outputBuffer, dimensions);
  object.device.queue.submit([encoder.finish()]);

  const error = await object.device.popErrorScope();
  if (error) {
    throw error;
  }

  await createPng(outputBuffer, dimensions, filename);
}
