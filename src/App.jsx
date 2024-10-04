import { Icon, ViewIcon, ViewOffIcon } from '@chakra-ui/icons';
import { Box, Flex, Input, Menu, MenuButton, MenuDivider, MenuItem, MenuList, Slider, SliderFilledTrack, SliderThumb, SliderTrack, Tab, TabList, TabPanel, TabPanels, Tabs, Text } from '@chakra-ui/react';
import { Buffer } from 'buffer';
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

function isPointInQuadrangle(point, squarePoints) {
  const [p1, p2, p3, p4] = squarePoints;

  function isLeft(p1, p2, p) {
    return (p2[0] - p1[0]) * (p.y - p1[1]) - (p2[1] - p1[1]) * (p.x - p1[0]) > 0;
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

const getScaledPoints = (points, scale) => {
  return points.map(point => [point[0] * scale, point[1] * scale]);
}

function create_canvas_context(w, h) {
  var canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext('2d');
  return ctx;
};

function drawPerspective(ctxd, cvso, points) {
  if (!cvso) return;

  var d0x = points[0][0];
  var d0y = points[0][1];
  var d1x = points[1][0];
  var d1y = points[1][1];
  var d2x = points[2][0];
  var d2y = points[2][1];
  var d3x = points[3][0];
  var d3y = points[3][1];
  //
  var ow = cvso.width;
  var oh = cvso.height;
  //
  var step = 16;
  var cover_step = step * 5;
  //
  var ctxo = cvso.getContext('2d');;
  var cvst = document.createElement('canvas');
  cvst.width = ctxd.canvas.width;
  cvst.height = ctxd.canvas.height;
  var ctxt = cvst.getContext('2d');
  ctxt.clearRect(0, 0, ctxt.canvas.width, ctxt.canvas.height);
  var ctxl = create_canvas_context(ow, cover_step);
  ctxl.globalCompositeOperation = "copy";
  var cvsl = ctxl.canvas;
  for (var y = 0; y < oh; y += step) {
    var r = y / oh;
    var sx = d0x + (d3x - d0x) * r;
    var sy = d0y + (d3y - d0y) * r;
    var ex = d1x + (d2x - d1x) * r;
    var ey = d1y + (d2y - d1y) * r;
    var ag = Math.atan((ey - sy) / (ex - sx));
    var sc = Math.sqrt(Math.pow(ex - sx, 2) + Math.pow(ey - sy, 2)) / ow;
    ctxl.setTransform(1, 0, 0, 1, 0, -y);
    ctxl.drawImage(ctxo.canvas, 0, 0);
    //
    ctxt.translate(sx, sy);
    ctxt.rotate(ag);
    ctxt.scale(sc, sc);
    ctxt.drawImage(cvsl, 0, 0);
    //
    ctxt.setTransform(1, 0, 0, 1, 0, 0);
  }

  ctxd.save();
  ctxd.beginPath();
  ctxd.moveTo(points[0][0], points[0][1]);
  for (var i = 1; i < points.length; i++) {
    ctxd.lineTo(points[i][0], points[i][1]);
  }
  ctxd.closePath();
  ctxd.clip();
  ctxd.drawImage(ctxt.canvas, 0, 0);
  ctxd.restore();
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
  const [points, setPoints] = useState(0);
  const [isResizable, setIsResizable] = useState(-1);
  const [isDraggable, setIsDraggable] = useState(false);
  const isDragging = useRef(false);
  const isResizing = useRef(-1);
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

      const coords = layer.coords;
      const points = [[coords.left, coords.top], [coords.right, coords.top], [coords.right, coords.bottom], [coords.left, coords.bottom]];

      return {
        id: uuidv4(),
        ...layerInfo,
        canvas: imgCanvas, points,
        mask: { canvas: maskCanvas, ...layerInfo.mask },
        children: parse(layer),
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
              const layer = { canvas, isImage: true, points: [[0, 0], [image.width, 0], [image.width, image.height], [0, image.height]] };
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
      if (id == selectedLayerId)
        setPoints(layer.points);
    }
  }

  const renderLayer = useCallback((ctx, layer) => {
    ctx.save();
    ctx.globalCompositeOperation = layer.blendMode.mode;
    ctx.globalAlpha = layer.opacity / 255;
    if (layer.image.hasMask) {
      const imgCanvas = document.createElement('canvas');
      imgCanvas.width = width;
      imgCanvas.height = height;
      const imgCtx = imgCanvas.getContext('2d');
      if (layer.isImage) {
        drawPerspective(imgCtx, layer.canvas, layer.points);
      } else if (layer.canvas) {
        imgCtx.drawImage(layer.canvas, layer.points[0][0], layer.points[0][1]);
      }
      const mask = layer.mask;
      if (mask.canvas) {
        imgCtx.globalCompositeOperation = 'destination-out';
        imgCtx.drawImage(mask.canvas, mask.left, mask.top);
      }
      ctx.drawImage(imgCanvas, 0, 0);
    } else {
      if (layer.isImage) {
        drawPerspective(ctx, layer.canvas, layer.points);
      } else if (layer.canvas) {
        ctx.drawImage(layer.canvas, layer.points[0][0], layer.points[0][1]);
      }
    }
    ctx.restore();
  }, [height, width]);

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
    if (points) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#6496C8';
      const points2 = getScaledPoints(points, scale);
      ctx.beginPath();
      ctx.moveTo(points2[points2.length - 1][0], points2[points2.length - 1][1]);
      for (let i = 0; i < points2.length; i++) {
        ctx.lineTo(points2[i][0], points2[i][1]);
        strokeRect(ctx, points2[i][0] - 5, points2[i][1] - 5, points2[i][0] + 5, points2[i][1] + 5);
      }
      ctx.stroke();
    }
  }, [points, scale]);

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
    const selectedLayer = await findDeep(layers, (layer) => layer.id == id);
    setPoints(selectedLayer.points);
    setSelectedLayerId(id);
  }

  const isMouseInQuadrangle = useCallback((mousePos) => {
    if (!points) return false;
    const points2 = getScaledPoints(points, scale);
    return isPointInQuadrangle(mousePos, points2);
  }, [points, scale]);

  const isMouseInResizeHandle = useCallback((mousePos) => {
    if (!points) return -1;
    const points2 = getScaledPoints(points, scale);
    for (let i = 0; i < points.length; i++) {
      if (isPointInSquare(mousePos, points2[i][0] - 5, points2[i][1] - 5, points2[i][0] + 5, points2[i][1] + 5))
        return i;
    }
    return -1;
  }, [points, scale]);

  const handleMouseDown = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const mousePos = getMousePos(canvas, event);
    startX.current = mousePos.x;
    startY.current = mousePos.y;
    isResizing.current = isMouseInResizeHandle(mousePos);
    isDragging.current = isResizing.current < 0 && isMouseInQuadrangle(mousePos);
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
      setPoints(selectedLayer.points.map(point => [point[0] + deltaX, point[1] + deltaY]));
    }

    if (isResizing.current >= 0) {
      const deltaX = (mousePos.x - startX.current) / scale;
      const deltaY = (mousePos.y - startY.current) / scale;
      const selectedLayer = await findDeep(layers, (layer) => layer.id == selectedLayerId);
      setPoints(selectedLayer.points.map((point, index) => {
        if (index == isResizing.current)
          return [point[0] + deltaX, point[1] + deltaY];
        return point;
      }));
    }
  }, [isMouseInQuadrangle, isMouseInResizeHandle, layers, scale, selectedLayerId]);

  const handleMouseUp = useCallback(async (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const mousePos = getMousePos(canvas, event);

    if (isDragging.current) {
      const deltaX = (mousePos.x - startX.current) / scale;
      const deltaY = (mousePos.y - startY.current) / scale;
      const selectedLayer = await findDeep(layers, (layer) => layer.id == selectedLayerId);
      setLayerProperty(selectedLayerId, { points: selectedLayer.points.map(point => [point[0] + deltaX, point[1] + deltaY]) });
    }

    if (isResizing.current >= 0) {
      const deltaX = (mousePos.x - startX.current) / scale;
      const deltaY = (mousePos.y - startY.current) / scale;
      const selectedLayer = await findDeep(layers, (layer) => layer.id == selectedLayerId);
      setLayerProperty(selectedLayerId, {
        points: selectedLayer.points.map((point, index) => {
          if (index == isResizing.current)
            return [point[0] + deltaX, point[1] + deltaY];
          return point;
        })
      });
    }

    isDragging.current = false;
    isResizing.current = -1;
  }, [layers, scale, selectedLayerId, setLayerProperty]);

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
              {layer.children.length == 0 && <Icon flex='none' as={VscFile} cursor='pointer' onClick={(e) => {
                e.stopPropagation();
                handleImageOpen(layer.id);
              }} />}
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
                cursor: isResizable >= 0 ? 'crosshair' : isDraggable ? 'move' : 'default'
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
