import { Icon, ViewIcon, ViewOffIcon } from '@chakra-ui/icons';
import { Box, Flex, Input, Menu, MenuButton, MenuDivider, MenuItem, MenuList, Slider, SliderFilledTrack, SliderThumb, SliderTrack, Tab, TabList, TabPanel, TabPanels, Tabs, Text } from '@chakra-ui/react';
import { Buffer } from 'buffer';
import PSD from 'psd3';
import { useCallback, useEffect, useRef, useState } from 'react';
import { VscFile } from 'react-icons/vsc';
import { v4 as uuidv4 } from 'uuid';
import './App.css';

const moveCursorMap = ['nw-resize', 'ne-resize', 'se-resize', 'sw-resize'];

const findDeep = async (collection, cmpFn) => {
  return await new Promise((resolve) => {
    const _findDeep = (obj) => {
      obj.forEach(obj => {
        if (cmpFn(obj))
          resolve(obj);
        _findDeep(obj.children);
      })
    }
    _findDeep(collection);
  })
};

const updateDeep = (collection, cmpFn, properties) => {
  return collection.map(obj => {
    if (cmpFn(obj))
      return { ...obj, ...properties };
    return { ...obj, children: updateDeep(obj.children, cmpFn, properties) };
  })
}

function isPointInQuadrangle(point, squarePoints) {
  const [p1, p2, p3, p4] = squarePoints;

  function isLeft(p1, p2, p) {
    return (p2.x - p1.x) * (p.y - p1.y) - (p2.y - p1.y) * (p.x - p1.x) > 0;
  }

  return (
    isLeft(p1, p2, point) &&
    isLeft(p2, p3, point) &&
    isLeft(p3, p4, point) &&
    isLeft(p4, p1, point)
  );
}

const isPointInSquare = (point, x1, y1, x2, y2) => {
  return point.x >= x1 && point.x <= x2 && point.y >= y1 && point.y <= y2;
}

function getTransformMatrix(x, y, scaleX, scaleY) {
  return [
    [scaleX, 0, x],
    [0, scaleY, y],
    [0, 0, 1]
  ]
}

const getTranslationMatrix = (x, y) => getTransformMatrix(x, y, 1, 1);
const getScaleMatrix = (scaleX, scaleY) => getTransformMatrix(0, 0, scaleX, scaleY);

function multiplyMatrices(A, B) {
  const rowsA = A.length;
  const colsA = A[0].length;
  const rowsB = B.length;
  const colsB = B[0].length;

  if (colsA !== rowsB) {
    throw new Error("Number of columns in A must equal number of rows in B");
  }

  const result = Array.from({ length: rowsA }, () => Array(colsB).fill(0));

  for (let i = 0; i < rowsA; i++) {
    for (let j = 0; j < colsB; j++) {
      for (let k = 0; k < colsA; k++) {
        result[i][j] += A[i][k] * B[k][j];
      }
    }
  }

  return result;
}

const strokeRect = (ctx, x1, y1, x2, y2) => {
  ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
};

const getMousePos = (canvas, event) => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
};

class Rect {
  constructor(left, top, right, bottom) {
    this.left = left;
    this.top = top;
    this.right = right;
    this.bottom = bottom;
  }

  width() {
    return this.right - this.left;
  }

  height() {
    return this.bottom - this.top;
  }
}

const getTransformedPoint = (point, M) => {
  const res = multiplyMatrices(M, [[point.x], [point.y], [1]]);
  return { x: res[0][0], y: res[1][0] };
}

const getTransformedRect = (rect, M) => {
  const points = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
  return points.map(point => getTransformedPoint(point, M));
}

function App() {
  const inputFileRef = useRef();
  const imageFileRef = useRef();

  const canvasRef = useRef();
  const guideLineCanvasRef = useRef();

  const [scale, setScale] = useState(1);
  const [width, setWidth] = useState(256);
  const [height, setHeight] = useState(256);

  const [layers, setLayers] = useState([]);
  const [selectedLayerId, setSelectedLayerId] = useState();
  const [rect, setRect] = useState();
  const [M, setM] = useState();
  const [isResizable, setIsResizable] = useState(0);
  const [isDraggable, setIsDraggable] = useState(false);
  const isDragging = useRef(false);
  const isResizing = useRef(0);
  const startX = useRef(0);
  const startY = useRef(0);

  const parse = (layer) => {
    return layer.children().map(layer => {
      const layerInfo = layer.layer;
      let imgCanvas = null;
      const img = layerInfo.image.toPng();
      if (img && img.width > 0 && img.height > 0) {
        const imageData = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
        imgCanvas = document.createElement('canvas');
        imgCanvas.width = img.width;
        imgCanvas.height = img.height;
        const ctx = imgCanvas.getContext('2d');
        ctx.putImageData(imageData, 0, 0);
      }
      let maskCanvas = null;
      const mask = layerInfo.image.maskToPng();
      if (mask && mask.width > 0 && mask.height > 0) {
        const maskData = new ImageData(new Uint8ClampedArray(mask.data), mask.width, mask.height);
        maskCanvas = document.createElement('canvas');
        maskCanvas.width = mask.width;
        maskCanvas.height = mask.height;
        const maskCtx = maskCanvas.getContext('2d');
        maskCtx.putImageData(maskData, 0, 0);
      }

      return {
        id: uuidv4(),
        children: parse(layer),
        ...layerInfo,
        canvas: imgCanvas, width: img.width, height: img.height, coords: { x: layer.coords.left, y: layer.coords.top }, scale: { x: 1, y: 1 },
        mask: { canvas: maskCanvas, width: mask.width, height: mask.height, coords: { x: layerInfo.mask.left, y: layerInfo.mask.top }, scale: { x: 1, y: 1 } },
      };
    });
  }

  const handleFileOpen = () => {
    inputFileRef.current?.click();
  }

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function (e) {
        const binaryString = e.target?.result;
        if (binaryString) {
          const psd = PSD.fromFile(Buffer.from(binaryString));
          psd.parse();
          if (psd.parsed) {
            setWidth(psd.header.width);
            setHeight(psd.header.height);
            setLayers(parse(psd.tree()));
          }
        }
      };
      reader.readAsArrayBuffer(file);
    }
  }

  function handleDownload(format) {
    const link = document.createElement('a');
    link.href = canvasRef.current.toDataURL(format);
    link.download = `canvas_image.${format === 'image/jpeg' ? 'jpg' : 'png'}`;
    link.click();
  }

  const handleImageOpen = async (id) => {
    if (imageFileRef.current) {
      imageFileRef.current.click();
      const layer = await new Promise((resolve, reject) => {
        const handleImageChange = async (event) => {
          const file = event.target.files[0];

          if (file) {
            const imageUrl = URL.createObjectURL(file);
            try {
              const image = await new Promise((resolve, reject) => {
                const image = new Image();
                image.src = imageUrl;
                image.onload = () => resolve(image);
                image.onerror = (err) => reject(err);
              });
              const canvas = document.createElement('canvas');
              canvas.width = image.width;
              canvas.height = image.height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(image, 0, 0);
              const layer = { canvas, width: image.width, height: image.height };
              resolve(layer);
            } catch (err) {
              reject(err);
            }
            URL.revokeObjectURL(imageUrl);
            imageFileRef.current.removeEventListener('change', handleImageChange);
          }
        }
        imageFileRef.current.addEventListener('change', handleImageChange);
      });
      setLayerProperty(id, layer);
    }
  }

  const handleSelectedLayerUpdate = useCallback(async () => {
    const layer = await findDeep(layers, (layer) => layer.id == selectedLayerId);
    setRect(new Rect(0, 0, layer.width, layer.height));
    setM(getTransformMatrix(layer.coords.x, layer.coords.y, layer.scale.x, layer.scale.y));
  }, [layers, selectedLayerId]);

  useEffect(() => {
    handleSelectedLayerUpdate();
  }, [handleSelectedLayerUpdate]);

  // Render frame
  const renderLayer = useCallback((ctx, layer) => {
    ctx.globalCompositeOperation = layer.blendMode.mode;
    if (layer.image.hasMask) {
      const imgCanvas = document.createElement('canvas');
      imgCanvas.width = width;
      imgCanvas.height = height;
      const imgCtx = imgCanvas.getContext('2d');
      if (layer.canvas) {
        if (layer.id == selectedLayerId && M)
          imgCtx.setTransform(M[0][0], 0, 0, M[1][1], M[0][2], M[1][2]);
        else
          imgCtx.setTransform(layer.scale.x, 0, 0, layer.scale.y, layer.coords.x, layer.coords.y);
        imgCtx.drawImage(layer.canvas, 0, 0);
      }
      const mask = layer.mask;
      if (mask.canvas) {
        imgCtx.globalCompositeOperation = 'destination-out';
        imgCtx.setTransform(mask.scale.x, 0, 0, mask.scale.y, mask.coords.x, mask.coords.y);
        imgCtx.drawImage(mask.canvas, 0, 0);
        imgCtx.globalCompositeOperation = 'source-over';
      }
      ctx.drawImage(imgCanvas, 0, 0);
    } else if (layer.canvas) {
      if (layer.id == selectedLayerId && M)
        ctx.setTransform(M[0][0], 0, 0, M[1][1], M[0][2], M[1][2]);
      else
        ctx.setTransform(layer.scale.x, 0, 0, layer.scale.y, layer.coords.x, layer.coords.y);
      ctx.drawImage(layer.canvas, 0, 0);
    }
    ctx.globalCompositeOperation = 'source-over';
  }, [M, height, selectedLayerId, width]);

  const renderLayers = useCallback((ctx, layers) => {
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer.visible) continue;
      const imageData = layer.image;
      if (imageData)
        renderLayer(ctx, layer);
      renderLayers(ctx, layer.children);
    }
  }, [renderLayer]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderLayers(ctx, layers, canvas.width, canvas.height);
  }, [layers, renderLayers]);

  const renderGuideLine = useCallback(async (ctx) => {
    if (rect) {
      ctx.strokeStyle = '#6496C8';

      const layer = await findDeep(layers, (layer) => layer.id == selectedLayerId);
      const VM = multiplyMatrices(getScaleMatrix(scale, scale), layer.id == selectedLayerId ? M : getTransformMatrix(layer.coords.x, layer.coords.y, layer.scale.x, layer.scale.y));

      const points = getTransformedRect(rect, VM);
      ctx.beginPath();
      ctx.moveTo(points[points.length - 1].x, points[points.length - 1].y);
      for (let i = 0; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
        strokeRect(ctx, points[i].x - 5, points[i].y - 5, points[i].x + 5, points[i].y + 5);
      }

      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }, [M, layers, rect, scale, selectedLayerId]);

  // Render guide line
  useEffect(() => {
    const canvas = guideLineCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderGuideLine(ctx);
  }, [scale, renderGuideLine]);

  const setLayerProperty = useCallback((id, property) => {
    setLayers(updateDeep(layers, (layer) => layer.id == id, property));
  }, [layers]);

  const handleLayerHide = (id) => {
    setLayerProperty(id, { visible: false });
  }

  const handleLayerShow = (id) => {
    setLayerProperty(id, { visible: true });
  }

  const handleLayerSelect = async (event, id) => {
    event.stopPropagation();
    setSelectedLayerId(id);
  }

  const isMouseInQuadrangle = useCallback((mousePos) => {
    if (!rect) return false;
    const VM = multiplyMatrices(getScaleMatrix(scale, scale), M);
    const points = getTransformedRect(rect, VM);
    return isPointInQuadrangle(mousePos, points);
  }, [M, rect, scale]);

  const isMouseInResizeHandle = useCallback((mousePos) => {
    if (!rect) return -1;
    const VM = multiplyMatrices(getScaleMatrix(scale, scale), M);
    const points = getTransformedRect(rect, VM);
    for (let i = 0; i < points.length; i++) {
      if (isPointInSquare(mousePos, points[i].x - 5, points[i].y - 5, points[i].x + 5, points[i].y + 5))
        return i;
    }
    return 0;
  }, [M, rect, scale]);

  const handleMouseDown = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const mousePos = getMousePos(canvas, event);
    startX.current = mousePos.x;
    startY.current = mousePos.y;
    isResizing.current = isMouseInResizeHandle(mousePos);
    isDragging.current = isResizing.current <= 0 && isMouseInQuadrangle(mousePos);
  }, [isMouseInQuadrangle, isMouseInResizeHandle]);

  const handleMouseMove = useCallback(async (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const mousePos = getMousePos(canvas, event);

    setIsResizable(isMouseInResizeHandle(mousePos));
    setIsDraggable(isMouseInQuadrangle(mousePos));

    if (isDragging.current) {
      const deltaX = (mousePos.x - startX.current) / scale;
      const deltaY = (mousePos.y - startY.current) / scale;
      const selectedLayer = await findDeep(layers, (layer) => layer.id == selectedLayerId);
      setM(multiplyMatrices(getTranslationMatrix(deltaX, deltaY), getTransformMatrix(selectedLayer.coords.x, selectedLayer.coords.y, selectedLayer.scale.x, selectedLayer.scale.y)));
    }

    if (isResizing.current > 0) {
      const points = getTransformedRect(rect, getScaleMatrix(scale, scale));
      const point = points[isResizing.current];
      const selectedLayer = await findDeep(layers, (layer) => layer.id == selectedLayerId);
      const originalPoint = { x: selectedLayer.coords.x * scale, y: selectedLayer.coords.y * scale };
      const scaleX = isResizing.current == 0 || isResizing.current == 3 ? M[0][0] : ((mousePos.x - originalPoint.x) / point.x);
      const scaleY = isResizing.current == 0 || isResizing.current == 1 ? M[1][1] : ((mousePos.y - originalPoint.y) / point.y);
      setM(getTransformMatrix(selectedLayer.coords.x, selectedLayer.coords.y, scaleX, scaleY));
    }
  }, [M, isMouseInQuadrangle, isMouseInResizeHandle, layers, rect, scale, selectedLayerId]);

  const handleMouseUp = useCallback(async (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const mousePos = getMousePos(canvas, event);

    if (isDragging.current) {
      const deltaX = (mousePos.x - startX.current) / scale;
      const deltaY = (mousePos.y - startY.current) / scale;
      const selectedLayer = await findDeep(layers, (layer) => layer.id == selectedLayerId);
      setLayerProperty(selectedLayerId, { coords: { x: selectedLayer.coords.x + deltaX, y: selectedLayer.coords.y + deltaY } });
    }

    if (isResizing.current > 0) {
      const points = getTransformedRect(rect, getScaleMatrix(scale, scale));
      const point = points[isResizing.current];
      const selectedLayer = await findDeep(layers, (layer) => layer.id == selectedLayerId);
      const originalPoint = { x: selectedLayer.coords.x * scale, y: selectedLayer.coords.y * scale };
      const scaleX = isResizing.current == 0 || isResizing.current == 3 ? M[0][0] : ((mousePos.x - originalPoint.x) / point.x);
      const scaleY = isResizing.current == 0 || isResizing.current == 1 ? M[1][1] : ((mousePos.y - originalPoint.y) / point.y);
      setLayerProperty(selectedLayerId, { scale: { x: scaleX, y: scaleY } });
    }

    isDragging.current = false;
    isResizing.current = 0;
  }, [M, layers, rect, scale, selectedLayerId, setLayerProperty]);

  const Layers = ({ layers }) => {
    return layers.map((layer) => (
      <Flex key={layer.id} borderTop='1px solid #2D3748' {...(selectedLayerId == layer.id && { bg: '#2D3748' })} _hover={{ bg: '#2D374880' }} onClick={(event) => handleLayerSelect(event, layer.id)}>
        <Flex px={2} borderRight='1px solid #2D3748' align='center'>
          {layer.visible ? <ViewIcon cursor='pointer' onClick={() => handleLayerHide(layer.id)} /> : <ViewOffIcon cursor='pointer' onClick={() => handleLayerShow(layer.id)} />}
        </Flex>
        <Box w='full'>
          <Flex flexGrow={1} px={4} py={2} align='center'>
            <Flex w='full' justify='space-between' align='center'>
              <Text>{layer.legacyName}</Text>
              {layer.children.length == 0 && <Icon flex='none' as={VscFile} cursor='pointer' onClick={() => handleImageOpen(layer.id)} />}
            </Flex>
          </Flex>
          <Flex direction='column'>
            <Layers layers={layer.children} />
          </Flex>
        </Box>
      </Flex>
    ))
  }

  return (
    <Flex w='100vw' h='100vh' direction='column'>
      <Input ref={inputFileRef} display='none' type='file' accept='.psd' onChange={handleFileChange} />
      <Input ref={imageFileRef} display='none' type='file' accept='image/*' />
      <Flex px={4} py={1} justify='space-between' borderBottom='1px solid #282828'>
        <Menu>
          <MenuButton>
            File
          </MenuButton>
          <MenuList>
            <MenuItem onClick={handleFileOpen}>Open PSD file</MenuItem>
            <MenuDivider />
            <MenuItem onClick={() => handleDownload('image/jpeg')}>Download(*.jpg)</MenuItem>
            <MenuItem onClick={() => handleDownload('image/png')}>Download(*.png)</MenuItem>
          </MenuList>
        </Menu>
        <Flex gap={4} align='center'>
          <Text>
            Scale {scale.toFixed(2)}
          </Text>
          <Slider w='240px' value={scale / 0.02} onChange={(value) => setScale(value * 0.02)}>
            <SliderTrack>
              <SliderFilledTrack />
            </SliderTrack>
            <SliderThumb />
          </Slider>
        </Flex>
      </Flex>
      <Flex flexGrow={1} w='full' h='calc(100vh - 33px)'>
        <Flex flexGrow={1} h='full' overflow='auto'>
          <Box flex='none' position='relative' style={{ width: width * scale, height: height * scale }}>
            <canvas ref={canvasRef} width={width} height={height} style={{ width: '100%', height: '100%' }} />
            <canvas
              ref={guideLineCanvasRef}
              width={width * scale} height={scale * height}
              style={{
                position: 'absolute', left: 0, top: 0, width: '100%', height: '100%',
                cursor: isResizable > 0 ? moveCursorMap[isResizable] : isDraggable ? 'move' : 'default'
              }}
              onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}
            />
          </Box>
        </Flex>
        <Box flex='none' w='320px' h='full' overflowY='auto' borderLeft='1px solid #282828'>
          <Tabs>
            <TabList>
              <Tab>Layer</Tab>
            </TabList>
            <TabPanels>
              <TabPanel p={2}>
                <Layers layers={layers} />
              </TabPanel>
            </TabPanels>
          </Tabs>
        </Box>
      </Flex>
    </Flex >
  )
}

export default App
