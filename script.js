// Bottone "sorprendimi": porta a caso su uno dei mini-siti
var projectLinks = ['./mini-sites/webgameshub/', './mini-sites/mangio-tutto/', './mini-sites/strumenti/', './mini-sites/appunti/'];
document.getElementById('surprise-btn').addEventListener('click', function(){
  var pick = projectLinks[Math.floor(Math.random() * projectLinks.length)];
  window.location.href = pick;
});

// ---------- Scena three.js di sfondo ----------
(function(){
  var canvas = document.getElementById('hero-canvas');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.z = 22;

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  var palette = [0xFF5D73, 0x4FD5FF, 0xFFC94D, 0xC6FF3D, 0xB98EFF];
  var geometries = [
    new THREE.TorusKnotGeometry(2.2, 0.6, 90, 12),
    new THREE.IcosahedronGeometry(2.4, 0),
    new THREE.OctahedronGeometry(2.6, 0),
    new THREE.TetrahedronGeometry(2.8, 0),
    new THREE.DodecahedronGeometry(2.2, 0)
  ];

  var shapes = [];
  var count = geometries.length;
  for (var i = 0; i < count; i++){
    var color = palette[i % palette.length];
    var geo = geometries[i];

    var group = new THREE.Group();

    var solidMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.09 });
    group.add(new THREE.Mesh(geo, solidMat));

    var edges = new THREE.EdgesGeometry(geo);
    var lineMat = new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.85 });
    group.add(new THREE.LineSegments(edges, lineMat));

    var angle = (i / count) * Math.PI * 2;
    var radius = 9 + (i % 2) * 3;
    group.position.set(
      Math.cos(angle) * radius,
      Math.sin(angle * 1.3) * 5,
      -6 - (i % 3) * 3
    );
    group.userData.baseY = group.position.y;
    group.userData.speed = 0.15 + Math.random() * 0.15;
    group.userData.rotSpeed = (0.08 + Math.random() * 0.1) * (i % 2 === 0 ? 1 : -1);
    group.userData.floatOffset = Math.random() * Math.PI * 2;

    scene.add(group);
    shapes.push(group);
  }

  var starCount = 220;
  var starPositions = new Float32Array(starCount * 3);
  for (var s = 0; s < starCount; s++){
    starPositions[s * 3] = (Math.random() - 0.5) * 60;
    starPositions[s * 3 + 1] = (Math.random() - 0.5) * 40;
    starPositions[s * 3 + 2] = -20 - Math.random() * 20;
  }
  var starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  var starMat = new THREE.PointsMaterial({ color: 0xF3F0FF, size: 0.12, transparent: true, opacity: 0.5 });
  scene.add(new THREE.Points(starGeo, starMat));

  var mouseX = 0, mouseY = 0, targetX = 0, targetY = 0;

  if (!reduceMotion){
    window.addEventListener('mousemove', function(e){
      mouseX = (e.clientX / window.innerWidth - 0.5);
      mouseY = (e.clientY / window.innerHeight - 0.5);
    });
  }

  window.addEventListener('resize', function(){
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  var clock = new THREE.Clock();
  var isVisible = true;
  document.addEventListener('visibilitychange', function(){
    isVisible = document.visibilityState === 'visible';
  });

  function render(){
    if (isVisible){
      var t = clock.getElapsedTime();

      if (!reduceMotion){
        targetX += (mouseX - targetX) * 0.03;
        targetY += (mouseY - targetY) * 0.03;
        camera.position.x = targetX * 4;
        camera.position.y = -targetY * 3;
        camera.lookAt(0, 0, -8);

        shapes.forEach(function(group){
          group.rotation.x += group.userData.rotSpeed * 0.01;
          group.rotation.y += group.userData.rotSpeed * 0.015;
          group.position.y = group.userData.baseY + Math.sin(t * group.userData.speed + group.userData.floatOffset) * 1.2;
        });
      }

      renderer.render(scene, camera);
    }
    requestAnimationFrame(render);
  }
  render();
})();
