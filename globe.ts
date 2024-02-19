import * as gmath from "gmath";
import {
  createBufferInit,
  OPENGL_TO_WGPU_MATRIX,
  Renderable,
} from "./utils.ts";

function vertex(pos: [number, number, number], tc: [number, number]): number[] {
  return [...pos, 1, ...tc];
}

function createVertices(): {
  vertexData: Float32Array;
  indexData: Uint16Array;
} {
  const numSegments = 20;
  const vertexData = [];
  const indexData = [];

  for (let i = 0; i <= numSegments; i++) {
    const lat0 = Math.PI * (i - 1) / numSegments;
    const z0 = Math.sin(lat0);
    const zr0 = Math.cos(lat0);

    const lat1 = Math.PI * i / numSegments;
    const z1 = Math.sin(lat1);
    const zr1 = Math.cos(lat1);

    for (let j = 0; j <= numSegments; j++) {
      const lng = 2 * Math.PI * j / numSegments;
      const x = Math.cos(lng);
      const y = Math.sin(lng);

      vertexData.push(
        ...vertex([x * zr0, y * zr0, z0], [j / numSegments, i / numSegments]),
      );
      vertexData.push(
        ...vertex([x * zr1, y * zr1, z1], [
          j / numSegments,
          (i + 1) / numSegments,
        ]),
      );

      const baseIndex = i * (numSegments + 1) + j;
      if (i < numSegments) {
        indexData.push(baseIndex, baseIndex + numSegments + 1, baseIndex + 1);
        indexData.push(
          baseIndex + 1,
          baseIndex + numSegments + 1,
          baseIndex + numSegments + 2,
        );
      }
    }
  }

  return {
    vertexData: new Float32Array(vertexData),
    indexData: new Uint16Array(indexData),
  };
}

function generateMatrix(aspectRatio = 1): Float32Array {
  const mxProjection = new gmath.PerspectiveFov(
    new gmath.Deg(45),
    aspectRatio,
    1,
    1000,
  ).toPerspective().toMatrix4();
  const mxView = gmath.Matrix4.lookAtRh(
    new gmath.Vector3(1.5, -5, 3),
    new gmath.Vector3(0, 0, 0),
    gmath.Vector3.forward(),
  );
  return OPENGL_TO_WGPU_MATRIX.mul(mxProjection.mul(mxView)).toFloat32Array();
}

export class Globe extends Renderable {
  pipeline!: GPURenderPipeline;
  bindGroup!: GPUBindGroup;
  indexBuffer!: GPUBuffer;
  vertexBuffer!: GPUBuffer;
  indexCount!: number;

  init() {
    const { vertexData, indexData } = createVertices();
    this.indexCount = indexData.length;

    this.vertexBuffer = createBufferInit(this.device, {
      label: "Vertex Buffer",
      usage: GPUBufferUsage.VERTEX,
      contents: vertexData.buffer,
    });

    this.indexBuffer = createBufferInit(this.device, {
      label: "Index Buffer",
      usage: GPUBufferUsage.INDEX,
      contents: indexData.buffer,
    });

    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: {
            minBindingSize: 64,
          },
        },
      ],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    const mxTotal = generateMatrix();
    const uniformBuffer = createBufferInit(this.device, {
      label: "Uniform Buffer",
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      contents: mxTotal.buffer,
    });

    this.bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: {
            buffer: uniformBuffer,
          },
        },
      ],
    });

    const shader = this.device.createShaderModule({
      code: Deno.readTextFileSync(new URL("./shader.wgsl", import.meta.url)),
    });
    const vertexBuffers: GPUVertexBufferLayout[] = [
      {
        arrayStride: 6 * 4,
        attributes: [
          {
            format: "float32x4",
            offset: 0,
            shaderLocation: 0,
          },
          {
            format: "float32x2",
            offset: 4 * 4,
            shaderLocation: 1,
          },
        ],
      },
    ];

    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shader,
        entryPoint: "vs_main",
        buffers: vertexBuffers,
      },
      fragment: {
        module: shader,
        entryPoint: "fs_main",
        targets: [
          {
            format: "rgba8unorm-srgb",
          },
        ],
      },
      primitive: {
        cullMode: "back",
      },
    });
  }

  render(encoder: GPUCommandEncoder, view: GPUTextureView) {
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: view,
          storeOp: "store",
          loadOp: "clear",
          clearValue: [0.1, 0.2, 0.3, 1],
        },
      ],
    });

    renderPass.pushDebugGroup("Prepare data for draw.");
    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    renderPass.setIndexBuffer(this.indexBuffer, "uint16");
    renderPass.setVertexBuffer(0, this.vertexBuffer);
    renderPass.popDebugGroup();
    renderPass.insertDebugMarker("Draw!");
    renderPass.drawIndexed(this.indexCount, 1);
    renderPass.end();
  }
}
