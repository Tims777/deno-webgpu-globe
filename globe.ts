import * as gmath from "gmath";
import {
  createBufferInit,
  OPENGL_TO_WGPU_MATRIX,
  Renderable,
} from "./utils.ts";

function vertex(pos: [number, number, number], tc: [number, number]): number[] {
  return [...pos, 1, ...tc];
}

const PI_2 = Math.PI * 2;

function createVertices(): {
  vertexData: Float32Array;
  indexData: Uint16Array;
} {
  const numSegments = 64;
  const vertices = [];
  const indices = [];

  for (let i = 0; i <= numSegments; i++) {
    const lat = Math.PI * i / numSegments;

    for (let j = 0; j <= numSegments; j++) {
      const lng = Math.PI * 2 * j / numSegments;
      const x = Math.sin(lat) * Math.cos(lng);
      const y = Math.sin(lat) * Math.sin(lng);
      const z = Math.cos(lat);

      vertices.push(
        vertex([x, y, z], [lat / PI_2, lng / PI_2]),
      );

      if (i < numSegments && j < numSegments) {
        const i0 = vertices.length - 1;
        const i1 = i0 + 1;
        const i2 = i0 + (numSegments + 1);
        const i3 = i2 + 1;
        indices.push(i2, i1, i0);
        indices.push(i1, i2, i3);
      }
    }
  }

  return {
    vertexData: new Float32Array(vertices.flat()),
    indexData: new Uint16Array(indices),
  };
}

function generateMatrix(aspectRatio = 1, rz: gmath.Angle): Float32Array {
  const mxProjection = new gmath.PerspectiveFov(
    new gmath.Deg(45),
    aspectRatio,
    1,
    1000,
  ).toPerspective().toMatrix4();
  const rot = gmath.Matrix4.fromAngleZ(rz);
  const mxView = gmath.Matrix4.lookAtRh(
    new gmath.Vector3(3, 0, 1),
    new gmath.Vector3(0, 0, 0),
    gmath.Vector3.forward(),
  );
  return OPENGL_TO_WGPU_MATRIX.mul(mxProjection.mul(mxView.mul(rot)))
    .toFloat32Array();
}

export class Globe extends Renderable {
  pipeline!: GPURenderPipeline;
  bindGroup!: GPUBindGroup;
  indexBuffer!: GPUBuffer;
  vertexBuffer!: GPUBuffer;
  indexCount!: number;
  bindGroupLayout!: GPUBindGroupLayout;

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

    this.bindGroupLayout = this.device.createBindGroupLayout({
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
      bindGroupLayouts: [this.bindGroupLayout],
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

    this.update(new gmath.Deg(0));
  }

  update(rz: gmath.Angle) {
    const mxTotal = generateMatrix(1, rz);
    const uniformBuffer = createBufferInit(this.device, {
      label: "Uniform Buffer",
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      contents: mxTotal.buffer,
    });

    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: {
            buffer: uniformBuffer,
          },
        },
      ],
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
