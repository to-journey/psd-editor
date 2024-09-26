import { Icon, ViewIcon, ViewOffIcon } from '@chakra-ui/icons';
import { Box, Flex, Input, Menu, MenuButton, MenuItem, MenuList, Slider, SliderFilledTrack, SliderThumb, SliderTrack, Tab, TabList, TabPanel, TabPanels, Tabs, Text } from '@chakra-ui/react';
import { Buffer } from 'buffer';
import _ from 'lodash';
import PSD from 'psd3';
import { useCallback, useEffect, useRef, useState } from 'react';
import { VscFile } from 'react-icons/vsc';
import { v4 as uuidv4 } from 'uuid';
import './App.css';

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

function isPointInSquare(point, squarePoints) {
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

const initM = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

function getTranslationMatrix(x, y) {
  const M = _.cloneDeep(initM);
  M[0][2] = x;
  M[1][2] = y;
  return M;
}

function getScaleTransformMatrix(scaleX, scaleY) {
  const M = _.cloneDeep(initM);
  M[0][0] = scaleX;
  M[1][1] = scaleY;
  return M;
}

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

const strokeRect = (ctx, x, y, size) => {
  ctx.strokeRect(x - size / 2, y - size / 2, size, size);
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

const getTransformedRect = (rect, M) => {
  const points = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];

  const transformedPoints = points.map(point => {
    const res = multiplyMatrices(M, [[point.x], [point.y], [1]]);
    return { x: res[0][0], y: res[1][0] };
  });

  return transformedPoints;
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
  const [isDraggable, setIsDraggable] = useState(false);
  const isDragging = useRef(false);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);

  const parse = (layer, width, height) => {
    return layer.children().map(layer => {
      const layerInfo = layer.layer;
      const img = layerInfo.image.length > 0 && layerInfo.image.toPng();
      const mask = layerInfo.image.hasMask && layerInfo.image.maskToPng();
      const imageData = img && new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
      const maskData = mask && new ImageData(new Uint8ClampedArray(mask.data), mask.width, mask.height);

      const coords = layer.coords;
      const maskCoords = layerInfo.mask;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = width;
      maskCanvas.height = height;
      const ctx = canvas.getContext('2d');
      const maskCtx = maskCanvas.getContext('2d');
      if (imageData)
        ctx.putImageData(imageData, coords.left, coords.top);
      if (maskData) {
        maskCtx.putImageData(maskData, maskCoords.left, maskCoords.top);
      }

      return { id: uuidv4(), children: parse(layer, width, height), ...layerInfo, canvas, maskCanvas, rect: new Rect(coords.left, coords.top, coords.right, coords.bottom), M: _.cloneDeep(initM) };
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
            setLayers(parse(psd.tree(), psd.header.width, psd.header.height));
          }
        }
      };
      reader.readAsArrayBuffer(file);
    }
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
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(image, 0, 0);
              const layer = { canvas, rect: new Rect(0, 0, image.width, image.height) };
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

  useEffect(() => {
    (async () => {
      const layer = await findDeep(layers, (layer) => layer.id == selectedLayerId);
      setM(layer.M);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayerId]);

  useEffect(() => {
    (async () => {
      const layer = await findDeep(layers, (layer) => layer.id == selectedLayerId);
      setRect(layer.rect);
    })();
  }, [layers, selectedLayerId]);

  // Render frame
  const renderLayer = useCallback((ctx, layer) => {
    ctx.globalCompositeOperation = layer.blendMode.mode;
    if (layer.image.hasMask) {
      const imgCanvas = document.createElement('canvas');
      imgCanvas.width = layer.canvas.width;
      imgCanvas.height = layer.canvas.height;
      const imgCtx = imgCanvas.getContext('2d');
      imgCtx.setTransform(layer.M[0][0], layer.M[0][1], layer.M[1][0], layer.M[1][1], layer.M[0][2], layer.M[1][2]);
      imgCtx.drawImage(layer.canvas, 0, 0);
      imgCtx.setTransform(initM);
      imgCtx.globalCompositeOperation = 'destination-out';
      imgCtx.drawImage(layer.maskCanvas, 0, 0);
      imgCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(imgCanvas, 0, 0);
    } else {
      ctx.setTransform(layer.M[0][0], layer.M[0][1], layer.M[1][0], layer.M[1][1], layer.M[0][2], layer.M[1][2]);
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.setTransform(initM);
    }
    ctx.globalCompositeOperation = 'source-over';
  }, []);

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
      const VM = multiplyMatrices(getScaleTransformMatrix(scale, scale), layer.M);

      const points = getTransformedRect(rect, VM);
      ctx.beginPath();
      ctx.moveTo(points[points.length - 1].x, points[points.length - 1].y);
      for (let i = 0; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
        strokeRect(ctx, points[i].x, points[i].y, 10, 10);
      }

      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }, [layers, rect, scale, selectedLayerId]);

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

  const handleLayerSelect = (event, id) => {
    event.stopPropagation();
    setSelectedLayerId(id);
  }

  const isMouseInSquare = useCallback((rect, mousePos) => {
    if (!rect) return false;
    const VM = multiplyMatrices(getScaleTransformMatrix(scale, scale), M);
    const points = getTransformedRect(rect, VM);
    return isPointInSquare(mousePos, points);
  }, [M, scale]);

  const isMouseInResizeHandle = (rect, mousePos) => {
    return (
      rect &&
      mousePos.x > rect.left + rect.width() / 2 - 5 &&
      mousePos.x < rect.left + rect.width() / 2 + 5 &&
      mousePos.y > rect.top + rect.height() / 2 - 5 &&
      mousePos.y < rect.top + rect.height() / 2 + 5
    );
  };

  const handleMouseDown = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const mousePos = getMousePos(canvas, event);
    if (isMouseInSquare(rect, mousePos)) {
      isDragging.current = true;
      startX.current = mousePos.x;
      startY.current = mousePos.y;
    } else if (isMouseInResizeHandle(rect, mousePos)) {
      isResizing.current = true;
    }
  }, [isMouseInSquare, rect]);

  const handleMouseMove = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const mousePos = getMousePos(canvas, event);

    setIsDraggable(isMouseInSquare(rect, mousePos));

    if (isDragging.current) {
      const deltaX = (mousePos.x - startX.current) / scale;
      const deltaY = (mousePos.y - startY.current) / scale;
      setLayerProperty(selectedLayerId, { M: multiplyMatrices(M, getTranslationMatrix(deltaX, deltaY)) });
    } else if (isResizing.current) {
      rect.width = mousePos.x - rect.left;
      rect.height = mousePos.y - rect.top;
    }
  }, [M, isMouseInSquare, rect, scale, selectedLayerId, setLayerProperty]);

  const handleMouseUp = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const mousePos = getMousePos(canvas, event);

    if (isDragging.current) {
      const deltaX = (mousePos.x - startX.current) / scale;
      const deltaY = (mousePos.y - startY.current) / scale;
      const newM = multiplyMatrices(M, getTranslationMatrix(deltaX, deltaY));
      setM(newM);
      setLayerProperty(selectedLayerId, { M: newM });
    }

    isDragging.current = false;
    isResizing.current = false;
  }, [M, scale, selectedLayerId, setLayerProperty]);

  const Layers = ({ layers }) => {
    return layers.map((layer) => (
      <Flex key={layer.id} borderTop='1px solid #2D3748' {...(selectedLayerId == layer.id && { bg: '#2D3748' })} _hover={{ bg: '#2D374880' }} onClick={(event) => handleLayerSelect(event, layer.id)}>
        <Flex px={2} borderRight='1px solid #2D3748' align='center'>
          {layer.visible ? <ViewIcon onClick={() => handleLayerHide(layer.id)} /> : <ViewOffIcon onClick={() => handleLayerShow(layer.id)} />}
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
            <MenuItem>Save as...</MenuItem>
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
              style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', cursor: isDraggable ? 'move' : 'default' }}
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
