function describeSupport(input) {
  switch (input) {
    case 'no': {
      return {
        className: 'no-support',
        description: `<span class="support">不支持</span>`,
      };
    }
    case 'yes': {
      return {
        className: 'has-support',
        description: `<span class="support">支持</span>`,
      };
    }
    case 'partial': {
      return {
        className: 'partial-support',
        description: `<span class="support">部分支持</span>`,
      };
    }
    default: {
      return {
        className: 'has-support',
        description: `<span class="support">自 <span class="version">${input}</span> 版本开始支持</span>`,
      };
    }
  }
}

const mapFromEnvironmentIdsToNames = new Map([
  ['chrome', 'Chrome'],
  ['firefox', 'Firefox'],
  ['safari', 'Safari'],
  ['nodejs', 'Node.js'],
  ['babel', 'Babel'],
]);

function environmentIdToName(input) {
  return mapFromEnvironmentIdsToNames.get(input);
}

function expandFeatureSupport(input) {
  // https://stackoverflow.com/a/1732454/96656
  const re = /<feature-support\s+chrome="(?<chrome>[^"]+)"\s+firefox="(?<firefox>[^"]+)"\s+safari="(?<safari>[^"]+)"\s+nodejs="(?<nodejs>[^"]+)"\s+babel="(?<babel>[^"]+)"><\/feature-support>/g;
  return input.replace(re, (...args) => {
    const groups = args[args.length - 1];
    const buf = ['<ul class="feature-support">'];
    for (const [key, value] of Object.entries(groups)) {
      const [version, url] = value.split(' ');
      const {className, description} = describeSupport(version);
      buf.push(`
        <li class="environment ${ className }${ url ? ' has-link' : ''}">
          ${ url ? `<a href="${ encodeURI(url) }">` : '' }
            <span class="icon ${ key }">${ environmentIdToName(key) }:</span>
            ${ description }
          ${ url ? '</a>' : '' }
        </li>
      `);
    }
    buf.push('</ul><div class="feature-support-info"><a href="/features/support">关于特性支持列表</a></div>');
    return buf.join('\n').replace(/\s+/g, ' ');
  });
}

module.exports = expandFeatureSupport;
