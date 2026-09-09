const webpack = require('webpack');
const path = require('node:path');
webpack({context:path.resolve(__dirname,'..'),entry:path.resolve(__dirname,'real-today-plan-harness.js'),
  output:{path:process.argv[2] || '/tmp/nautilus-real-today-plan',filename:'harness.js'},
  module:{rules:[{test:/\.cljs$/,type:'asset/source'}]},mode:'development',devtool:false,target:'web'},(error,stats)=>{
  if(error || stats.hasErrors()){console.error(error || stats.toString());process.exitCode=1;}
});
